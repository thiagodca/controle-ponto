// Lógica do aviso diário de inconsistências por e-mail.
//
// Módulo PURO (sem rede, sem banco, sem React): recebe dados já carregados e
// devolve (a) quais funcionários atingiram o limite configurado e (b) o
// conteúdo do e-mail. Quem busca os dados e envia o e-mail é a função de
// servidor em api/cron-inconsistencias.js — separar assim permite testar a
// regra sem depender de Supabase nem do serviço de e-mail.

import { calcularInconsistencias } from './pontoCalc.js';

const JANELA_MESES = 3; // mês atual + 2 anteriores — mesma janela usada na tela do app

const pad2 = (n) => String(n).padStart(2, '0');

// Devolve os últimos `qtd` meses a partir de uma data 'YYYY-MM-DD',
// do mais recente para o mais antigo: [{ mes, ano }, ...]
export const ultimosMeses = (hojeStr, qtd = JANELA_MESES) => {
  let ano = Number(hojeStr.slice(0, 4));
  let mes = Number(hojeStr.slice(5, 7));
  const meses = [];
  for (let i = 0; i < qtd; i++) {
    meses.push({ mes, ano });
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
  }
  return meses;
};

// Primeiro dia da janela de apuração ('YYYY-MM-01'), usado para limitar as
// consultas ao banco apenas aos dados que importam.
export const inicioDaJanela = (hojeStr, qtd = JANELA_MESES) => {
  const meses = ultimosMeses(hojeStr, qtd);
  const maisAntigo = meses[meses.length - 1];
  return `${maisAntigo.ano}-${pad2(maisAntigo.mes)}-01`;
};

// Para cada aviso configurado, apura as inconsistências em aberto na janela e
// devolve só os funcionários que atingiram (ou passaram) o limite.
//
// alertas:   [{ userId, threshold }]
// usuarios:  [{ id, name, email, profile }]
// demais:    mesmo formato usado pelo app (ver calcularInconsistencias)
// correcoes: [{ userId, date, status }] — correções já enviadas pelo funcionário
export const montarAvisos = ({ hojeStr, alertas, usuarios, registros, atestados, abonos, feriados, ferias, correcoes = [] }) => {
  const meses = ultimosMeses(hojeStr);
  const avisos = [];

  for (const alerta of alertas) {
    const limite = Number(alerta.threshold);
    if (!Number.isInteger(limite) || limite < 1) continue; // configuração inválida: ignora
    const usuario = usuarios.find(u => u.id === alerta.userId);
    if (!usuario) continue; // funcionário removido

    let inconsistencias = [];
    for (const { mes, ano } of meses) {
      inconsistencias = inconsistencias.concat(
        calcularInconsistencias({ userId: alerta.userId, mes, ano, hojeStr, registros, atestados, abonos, feriados, ferias })
      );
    }
    inconsistencias.sort((a, b) => a.date.localeCompare(b.date));

    if (inconsistencias.length >= limite) {
      avisos.push({
        usuario,
        limite,
        inconsistencias: inconsistencias.map(inc => ({
          ...inc,
          // Se o funcionário já mandou uma correção, o admin só precisa aprovar —
          // vale destacar isso no e-mail.
          correcaoPendente: correcoes.some(c => c.userId === alerta.userId && c.date === inc.date && c.status === 'pendente'),
        })),
      });
    }
  }
  return avisos;
};

// ---------- Montagem do e-mail ----------

const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const dataBr = (dateStr) => `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}/${dateStr.slice(0, 4)}`;
const hhmm = (t) => (t ? t.substring(0, 5) : '—');
const plural = (n, singular, pluralTxt) => `${n} ${n === 1 ? singular : pluralTxt}`;

const marcacoes = (inc) =>
  `Entrada ${hhmm(inc.entrada)} · Início intervalo ${hhmm(inc.inicioIntervalo)} · Fim intervalo ${hhmm(inc.fimIntervalo)} · Saída ${hhmm(inc.saida)}`;

export const montarEmail = ({ avisos, hojeStr, appUrl = '' }) => {
  const assunto = avisos.length === 1
    ? `Controle de Ponto: ${avisos[0].usuario.name} tem ${plural(avisos[0].inconsistencias.length, 'inconsistência', 'inconsistências')} em aberto`
    : `Controle de Ponto: inconsistências em ${avisos.length} funcionários`;

  const rodapeTexto = 'Este aviso é enviado automaticamente todo dia por volta das 18h e se repete enquanto o limite continuar atingido. '
    + 'Para alterar quem é monitorado: app > Início > Avisos por e-mail.';

  // ----- texto puro -----
  const linhasTexto = [`Inconsistências em aberto (apuração de ${dataBr(hojeStr)})`, ''];
  for (const aviso of avisos) {
    linhasTexto.push(`${aviso.usuario.name} — ${plural(aviso.inconsistencias.length, 'inconsistência', 'inconsistências')} (limite configurado: ${aviso.limite})`);
    for (const inc of aviso.inconsistencias) {
      linhasTexto.push(`  • ${dataBr(inc.date)} (${inc.diaSemana.nome}): ${inc.motivo}`);
      linhasTexto.push(`    ${marcacoes(inc)}`);
      if (inc.correcaoPendente) linhasTexto.push('    O funcionário já enviou uma correção, aguardando a sua aprovação.');
    }
    linhasTexto.push('');
  }
  linhasTexto.push(rodapeTexto);
  if (appUrl) linhasTexto.push(`Abrir o sistema: ${appUrl}`);

  // ----- HTML (estilos inline: clientes de e-mail ignoram <style>) -----
  const blocos = avisos.map(aviso => {
    const itens = aviso.inconsistencias.map(inc => `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111827;">${esc(dataBr(inc.date))} <span style="font-weight:400;color:#6b7280;">(${esc(inc.diaSemana.nome)})</span></div>
            <div style="color:#b45309;margin-top:2px;">${esc(inc.motivo)}</div>
            <div style="color:#6b7280;font-size:13px;margin-top:4px;">${esc(marcacoes(inc))}</div>
            ${inc.correcaoPendente ? '<div style="margin-top:6px;font-size:13px;color:#4338ca;background:#eef2ff;border-radius:6px;padding:6px 8px;">O funcionário já enviou uma correção — aguardando a sua aprovação.</div>' : ''}
          </td>
        </tr>`).join('');
    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:18px;font-weight:700;color:#111827;">${esc(aviso.usuario.name)}</div>
        <div style="color:#dc2626;font-weight:600;margin:2px 0 6px;">${esc(plural(aviso.inconsistencias.length, 'inconsistência', 'inconsistências'))} em aberto <span style="color:#6b7280;font-weight:400;">(limite configurado: ${aviso.limite})</span></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itens}</table>
      </div>`;
  }).join('');

  const botao = appUrl
    ? `<p style="margin:24px 0 0;"><a href="${esc(appUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">Abrir o sistema</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border-radius:12px;padding:24px;">
        <h1 style="margin:0 0 4px;font-size:20px;color:#111827;">Inconsistências em aberto</h1>
        <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Apuração de ${esc(dataBr(hojeStr))} (últimos 3 meses)</p>
        ${blocos}
        ${botao}
      </div>
      <p style="color:#9ca3af;font-size:12px;line-height:1.5;margin:16px 4px 0;">${esc(rodapeTexto)}</p>
    </div>
  </body>
</html>`;

  return { assunto, html, texto: linhasTexto.join('\n') };
};
