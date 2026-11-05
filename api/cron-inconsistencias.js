// Função de servidor (Vercel) — aviso diário de inconsistências por e-mail.
//
// Disparada todo dia pelo agendamento definido em vercel.json (Vercel Cron).
// Fluxo: confere a autenticação -> busca os dados no Supabase -> apura quem
// atingiu o limite configurado -> envia UM e-mail consolidado para cada admin.
//
// Variáveis de ambiente (configuradas no painel da Vercel, NUNCA no código —
// este repositório é público):
//   CRON_SECRET     (obrigatória) segredo que protege este endereço; a Vercel o
//                   envia automaticamente no cabeçalho Authorization do cron.
//   RESEND_API_KEY  (obrigatória) chave da conta Resend, usada para enviar o e-mail.
//   EMAIL_FROM      (opcional)   remetente. Padrão: Controle de Ponto <onboarding@resend.dev>
//   APP_URL         (opcional)   endereço do sistema, para o botão "Abrir o sistema".
//   SUPABASE_URL / SUPABASE_KEY (opcionais) padrão: os mesmos valores públicos já usados pelo app.

import { timingSafeEqual } from 'node:crypto';
import { inicioDaJanela, montarAvisos, montarEmail } from '../src/lib/avisosInconsistencia.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rnabihjpvnvyrvpwpyjv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_Mm_lgPs-Zvni1xmdNEvZxA_ZlmbXYHN';
const TAMANHO_PAGINA = 1000; // limite padrão de linhas por consulta do Supabase

// Data de hoje no Brasil ('YYYY-MM-DD'). O servidor roda em UTC, então o fuso
// precisa ser explícito — senão "hoje" poderia ser um dia diferente.
const hojeNoBrasil = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// Compara segredos sem vazar informação pelo tempo de resposta.
const segredoConfere = (recebido, esperado) => {
  const a = Buffer.from(recebido || '');
  const b = Buffer.from(esperado || '');
  return a.length === b.length && timingSafeEqual(a, b);
};

// Busca TODAS as linhas de uma consulta, página por página (o Supabase corta
// silenciosamente em 1000 linhas se não paginar).
const buscarTudo = async (tabela, query = '') => {
  const consulta = query.includes('order=') ? query : `${query}${query ? '&' : '?'}order=id.asc`;
  const linhas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${consulta}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Range-Unit': 'items',
        Range: `${inicio}-${inicio + TAMANHO_PAGINA - 1}`,
      },
    });
    if (resposta.status === 416) break; // pedimos além do fim: acabaram as linhas
    if (!resposta.ok) throw new Error(`Supabase (${tabela}) falhou: ${resposta.status} — ${await resposta.text()}`);
    const lote = await resposta.json();
    linhas.push(...lote);
    if (lote.length < TAMANHO_PAGINA) break;
  }
  return linhas;
};

const enviarEmail = async ({ chave, de, para, assunto, html, texto }) => {
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
      'User-Agent': 'controle-ponto-cron/1.0',
    },
    body: JSON.stringify({ from: de, to: [para], subject: assunto, html, text: texto }),
  });
  const corpo = await resposta.text();
  if (!resposta.ok) throw new Error(`Resend ${resposta.status}: ${corpo}`);
};

export default async function handler(req, res) {
  // 1) Segurança: sem o segredo, qualquer pessoa que descobrisse este endereço
  //    poderia disparar e-mails. Se o segredo nem estiver configurado, recusa tudo.
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(500).json({ erro: 'CRON_SECRET não está configurado na Vercel.' });
  const cabecalho = req.headers.authorization || '';
  if (!segredoConfere(cabecalho, `Bearer ${segredo}`)) return res.status(401).json({ erro: 'Não autorizado.' });

  const chaveResend = process.env.RESEND_API_KEY;
  if (!chaveResend) return res.status(500).json({ erro: 'RESEND_API_KEY não está configurada na Vercel.' });

  try {
    const hojeStr = hojeNoBrasil();
    const inicio = inicioDaJanela(hojeStr);

    // 2) Quem está sendo monitorado?
    const [alertasDb, usuariosDb] = await Promise.all([
      buscarTudo('alertas_inconsistencia', '?select=user_id,threshold'),
      buscarTudo('usuarios', '?select=id,name,email,profile'),
    ]);
    if (alertasDb.length === 0) {
      return res.status(200).json({ enviado: false, motivo: 'Nenhum aviso configurado.' });
    }

    // 3) Só busca o que é necessário: funcionários monitorados, janela de 3 meses.
    const filtroUsuarios = `user_id=in.(${[...new Set(alertasDb.map(a => a.user_id))].join(',')})`;
    const [registrosDb, atestadosDb, abonosDb, feriadosDb, feriasDb, correcoesDb] = await Promise.all([
      buscarTudo('registros_ponto', `?select=user_id,date,time,address,manually_adjusted,adjustment_reason&${filtroUsuarios}&date=gte.${inicio}`),
      buscarTudo('atestados', `?select=user_id,date,hours,justification&${filtroUsuarios}&date=gte.${inicio}`),
      buscarTudo('horas_abonadas', `?select=user_id,date,hours,justification&${filtroUsuarios}&date=gte.${inicio}`),
      buscarTudo('feriados', '?select=date,description'),
      buscarTudo('ferias', `?select=user_id,start_date,end_date&${filtroUsuarios}`),
      // Detalhe opcional do e-mail: se esta consulta falhar, o aviso sai mesmo assim.
      buscarTudo('correcoes_pendentes', `?select=user_id,date,status&status=eq.pendente&${filtroUsuarios}`).catch(() => []),
    ]);

    // 4) Converte para o mesmo formato que o app usa internamente.
    const avisos = montarAvisos({
      hojeStr,
      alertas: alertasDb.map(a => ({ userId: a.user_id, threshold: a.threshold })),
      usuarios: usuariosDb,
      registros: registrosDb.map(r => ({
        userId: r.user_id, date: r.date, time: r.time, address: r.address,
        manuallyAdjusted: r.manually_adjusted || false, adjustmentReason: r.adjustment_reason || null,
      })),
      atestados: atestadosDb.map(a => ({ userId: a.user_id, date: a.date, hours: parseFloat(a.hours), justification: a.justification })),
      abonos: abonosDb.map(a => ({ userId: a.user_id, date: a.date, hours: parseFloat(a.hours), justification: a.justification })),
      feriados: feriadosDb.map(f => ({ date: f.date, description: f.description })),
      ferias: feriasDb.map(v => ({ userId: v.user_id, startDate: v.start_date, endDate: v.end_date })),
      correcoes: correcoesDb.map(c => ({ userId: c.user_id, date: c.date, status: c.status })),
    });

    if (avisos.length === 0) {
      return res.status(200).json({ enviado: false, motivo: 'Nenhum funcionário atingiu o limite configurado.', apuracao: hojeStr });
    }

    // 5) Um e-mail consolidado, enviado separadamente para cada admin (assim, se um
    //    endereço for recusado, os outros ainda recebem).
    const destinatarios = usuariosDb.filter(u => u.profile === 'admin' && u.email);
    if (destinatarios.length === 0) {
      return res.status(500).json({ erro: 'Nenhum administrador com e-mail cadastrado.' });
    }

    const urlDoApp = process.env.APP_URL
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
    const { assunto, html, texto } = montarEmail({ avisos, hojeStr, appUrl: urlDoApp });
    const remetente = process.env.EMAIL_FROM || 'Controle de Ponto <onboarding@resend.dev>';

    const resultados = [];
    for (const admin of destinatarios) {
      try {
        await enviarEmail({ chave: chaveResend, de: remetente, para: admin.email, assunto, html, texto });
        resultados.push({ email: admin.email, ok: true });
      } catch (erro) {
        console.error(`Falha ao enviar e-mail para ${admin.email}:`, erro.message);
        resultados.push({ email: admin.email, ok: false, erro: erro.message });
      }
    }

    const algumEnviado = resultados.some(r => r.ok);
    return res.status(algumEnviado ? 200 : 502).json({
      enviado: algumEnviado,
      apuracao: hojeStr,
      funcionarios: avisos.map(a => ({ nome: a.usuario.name, inconsistencias: a.inconsistencias.length, limite: a.limite })),
      destinatarios: resultados,
    });
  } catch (erro) {
    console.error('Erro no aviso diário de inconsistências:', erro);
    return res.status(500).json({ erro: erro.message });
  }
}
