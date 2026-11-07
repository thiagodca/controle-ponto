// Lógica de apuração de ponto compartilhada.
//
// Este módulo é PURO (sem React, sem navegador, sem acesso a banco): recebe
// dados e devolve resultados. Ele é usado em dois lugares:
//   1. Pelo app (src/App.jsx), para mostrar horas, relatórios e inconsistências.
//   2. Pela função de servidor (api/cron-inconsistencias.js), que envia o aviso
//      diário por e-mail ao admin.
// Manter a regra em um único lugar garante que a tela e o e-mail nunca
// divirjam sobre o que é (ou não) uma inconsistência.

export const formatHoras = (valor) => {
  if (valor === null || valor === undefined) return '—';
  const sinal = valor < 0 ? '-' : '';
  const abs = Math.abs(valor);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${sinal}${h}h${m.toString().padStart(2, '0')}`;
};

export const NOMES_DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Retorna o nome do dia da semana e se é fim de semana, a partir de "YYYY-MM-DD".
// Usa os componentes da data diretamente (em vez de new Date(dateStr) puro)
// para evitar problemas de fuso horário que deslocariam o dia da semana.
export const getDiaSemana = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const data = new Date(year, month - 1, day);
  const indice = data.getDay(); // 0 = domingo, 6 = sábado
  return { nome: NOMES_DIAS_SEMANA[indice], isFimDeSemana: indice === 0 || indice === 6 };
};

// Converte "HH:MM:SS" em minutos desde a meia-noite, para facilitar cálculos
export const timeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 60 + m + (s || 0) / 60;
};

// Calcula as métricas de um único dia (entrada, intervalo, saída, horas
// trabalhadas e horas extras) a partir dos registros de ponto daquele dia.
//
// Regras assumidas (combinadas com o usuário):
// - 2 marcações no dia = entrada + saída, sem intervalo marcado → assume-se
//   1 hora de intervalo automaticamente.
// - 4 marcações no dia = entrada, início do intervalo, fim do intervalo, saída.
// - 1 ou 3 marcações = dia incompleto (falta alguma marcação); não entra no
//   somatório de horas.
// - Dia sem nenhuma marcação = não trabalhado; não entra no somatório.
export const JORNADA_DIARIA_HORAS = 8;

export const getDayMetrics = (dateStr, allRecords, atestado = null, feriado = null, ferias = null, abono = null) => {
  const dayRecords = allRecords
    .filter(r => r.date === dateStr)
    .sort((a, b) => a.time.localeCompare(b.time));

  const punches = dayRecords.map(r => r.time);
  const addresses = dayRecords.map(r => r.address);
  const n = punches.length;

  let entrada = null, inicioIntervalo = null, fimIntervalo = null, saida = null;
  let entradaAddress = null, inicioIntervaloAddress = null, fimIntervaloAddress = null, saidaAddress = null;
  let horasTrabalhadas = null;
  let status = 'sem-registro';

  if (n === 0) {
    status = 'sem-registro';
  } else if (n === 1) {
    entrada = punches[0];
    entradaAddress = addresses[0];
    status = 'incompleto';
  } else if (n === 2) {
    entrada = punches[0];
    saida = punches[1];
    entradaAddress = addresses[0];
    saidaAddress = addresses[1];
    const totalMin = timeToMinutes(saida) - timeToMinutes(entrada) - 60; // assume 1h de intervalo
    horasTrabalhadas = Math.max(0, totalMin) / 60;
    status = 'completo';
  } else if (n === 3) {
    entrada = punches[0];
    inicioIntervalo = punches[1];
    fimIntervalo = punches[2];
    entradaAddress = addresses[0];
    inicioIntervaloAddress = addresses[1];
    fimIntervaloAddress = addresses[2];
    status = 'incompleto'; // falta a marcação de saída
  } else {
    entrada = punches[0];
    inicioIntervalo = punches[1];
    fimIntervalo = punches[2];
    saida = punches[3];
    entradaAddress = addresses[0];
    inicioIntervaloAddress = addresses[1];
    fimIntervaloAddress = addresses[2];
    saidaAddress = addresses[3];
    const minTrabalhados = (timeToMinutes(inicioIntervalo) - timeToMinutes(entrada)) +
                            (timeToMinutes(saida) - timeToMinutes(fimIntervalo));
    horasTrabalhadas = Math.max(0, minTrabalhados) / 60;
    status = 'completo';
  }

  // Regras de atestado médico:
  // - Se há lançamento (2 ou 4 marcações = status "completo"), soma-se as
  //   horas do atestado às horas realmente trabalhadas.
  // - Se não há nenhuma marcação ("sem-registro"), as horas trabalhadas do
  //   dia passam a ser as horas do atestado (cobertura total ou parcial).
  // - Se há apenas 1 ou 3 marcações ("incompleto"), o atestado não altera
  //   nada — o dia continua incompleto por falta de marcação de saída/etc.
  if (atestado) {
    if (status === 'completo') {
      horasTrabalhadas = (horasTrabalhadas || 0) + atestado.hours;
    } else if (status === 'sem-registro') {
      status = 'completo';
      horasTrabalhadas = atestado.hours;
    }
  }

  // Abono integral (>= jornada) em dia sem nenhuma marcação: o dia fica
  // justificado, com 0h trabalhadas (o abono não soma horas, só anula a falta
  // abaixo). Abono parcial sem marcações NÃO resolve o dia: continua como
  // "sem-registro" (inconsistência de dia útil sem marcação).
  if (!atestado && abono && status === 'sem-registro' && abono.hours >= JORNADA_DIARIA_HORAS) {
    status = 'completo';
    horasTrabalhadas = 0;
  }

  let horasExtras = horasTrabalhadas !== null ? horasTrabalhadas - JORNADA_DIARIA_HORAS : null;

  // Havendo atestado médico (de qualquer quantidade de horas), a hora extra
  // do dia nunca fica negativa — a ausência parcial está justificada.
  if (atestado && horasExtras !== null) {
    horasExtras = Math.max(0, horasExtras);
  }

  // Regras de horas abonadas: diferente do atestado, o abono NÃO soma às
  // horas trabalhadas exibidas (o total trabalhado continua sendo o que o
  // colaborador de fato bateu). O abono só evita que a falta gere hora
  // extra negativa, abatendo exatamente o que faltou — se o abono for maior
  // que a falta do dia, o excedente é descartado (nunca gera crédito
  // positivo).
  let abonoAplicado = 0;
  if (abono && horasExtras !== null && horasExtras < 0) {
    const falta = -horasExtras;
    abonoAplicado = Math.min(abono.hours, falta);
    horasExtras = horasExtras + abonoAplicado;
  }

  // Nova inconsistência: mesmo com atestado, se o total de horas (lançamento
  // + atestado, ou só atestado quando não há lançamento) ficar abaixo da
  // jornada diária, ainda é uma inconsistência — falta alguma coisa explicar.
  const atestadoInsuficiente = !!(atestado && status === 'completo' && horasTrabalhadas < JORNADA_DIARIA_HORAS);

  // Mesma ideia para abono: se o abono não foi suficiente para cobrir toda
  // a falta do dia, ainda sobra hora extra negativa — sinaliza para o admin
  // revisar (o abono parcial já foi aplicado acima, mas não resolveu tudo).
  const abonoInsuficiente = !!(abono && status === 'completo' && horasExtras !== null && horasExtras < 0);

  const isManuallyAdjusted = dayRecords.some(r => r.manuallyAdjusted);
  const adjustmentReason = dayRecords.find(r => r.adjustmentReason)?.adjustmentReason || null;

  return {
    date: dateStr, entrada, inicioIntervalo, fimIntervalo, saida,
    entradaAddress, inicioIntervaloAddress, fimIntervaloAddress, saidaAddress,
    horasTrabalhadas, horasExtras, status, isManuallyAdjusted, adjustmentReason,
    temAtestado: !!atestado,
    atestadoHoras: atestado ? atestado.hours : null,
    atestadoJustificativa: atestado ? atestado.justification : null,
    atestadoInsuficiente,
    temAbono: !!abono,
    abonoHoras: abono ? abono.hours : null,
    abonoJustificativa: abono ? abono.justification : null,
    abonoInsuficiente,
    isHoliday: !!feriado,
    holidayDescription: feriado ? feriado.description : null,
    isVacation: !!ferias,
    vacationRange: ferias ? { start: ferias.startDate, end: ferias.endDate } : null,
  };
};

// Apura as inconsistências de UM funcionário em UM mês. Ignora hoje e datas
// futuras (o dia de hoje ainda pode receber marcações), dias marcados como
// feriado e dias de férias do funcionário.
//
// Parâmetros (todos arrays no formato usado pelo app):
//   registros: [{ userId, date, time, address, manuallyAdjusted, adjustmentReason }]
//   atestados / abonos: [{ userId, date, hours, justification }]
//   feriados: [{ date, description }]
//   ferias: [{ userId, startDate, endDate }]
//   hojeStr: 'YYYY-MM-DD' (injetado, para o servidor poder usar o fuso do Brasil)
export const calcularInconsistencias = ({ userId, mes, ano, hojeStr, registros, atestados, abonos, feriados, ferias }) => {
  const userRecords = registros.filter(r => r.userId === userId);
  const atestadoPorData = Object.fromEntries(atestados.filter(a => a.userId === userId).map(a => [a.date, a]));
  const abonoPorData = Object.fromEntries(abonos.filter(a => a.userId === userId).map(a => [a.date, a]));
  const diasNoMes = new Date(ano, mes, 0).getDate();

  const inconsistencias = [];
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    if (dateStr >= hojeStr) continue; // ignora hoje e datas futuras
    if (feriados.some(h => h.date === dateStr)) continue; // dia marcado como feriado — resolvido
    if (ferias.some(v => v.userId === userId && dateStr >= v.startDate && dateStr <= v.endDate)) continue; // férias

    const metrics = getDayMetrics(dateStr, userRecords, atestadoPorData[dateStr] || null, null, null, abonoPorData[dateStr] || null);
    const diaSemana = getDiaSemana(dateStr);

    if (metrics.status === 'incompleto') {
      const motivo = metrics.saida === null && metrics.fimIntervalo === null
        ? 'Apenas 1 marcação registrada (entrada) — faltam início/fim do intervalo e a saída'
        : '3 marcações registradas (entrada, início e fim do intervalo) — falta a saída';
      inconsistencias.push({ ...metrics, diaSemana, motivo });
    } else if (metrics.atestadoInsuficiente) {
      const motivo = metrics.entrada
        ? `Atestado de ${metrics.atestadoHoras}h somado às marcações totaliza apenas ${formatHoras(metrics.horasTrabalhadas)} — menos que a jornada de ${JORNADA_DIARIA_HORAS}h`
        : `Atestado de ${metrics.atestadoHoras}h não cobre a jornada de ${JORNADA_DIARIA_HORAS}h e não há nenhuma marcação de ponto`;
      inconsistencias.push({ ...metrics, diaSemana, motivo });
    } else if (metrics.abonoInsuficiente) {
      const motivo = `Abono de ${metrics.abonoHoras}h não cobre toda a falta do dia — ainda restam ${formatHoras(-metrics.horasExtras)} não justificadas`;
      inconsistencias.push({ ...metrics, diaSemana, motivo });
    } else if (metrics.status === 'sem-registro' && !diaSemana.isFimDeSemana) {
      inconsistencias.push({ ...metrics, diaSemana, motivo: 'Dia útil sem nenhuma marcação de ponto' });
    }
  }
  return inconsistencias;
};
