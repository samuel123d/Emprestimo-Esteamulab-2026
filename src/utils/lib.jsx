// Funções compartilhadas pelas telas para datas, empréstimos e apresentação de status.

// Gera IDs curtos para documentos novos do Firestore.
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Formata uma data como AAAA-MM-DD sem depender do fuso UTC do navegador.
export const ymd = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Retorna a data local de hoje no formato usado pelos formulários.
export const today = () => ymd(new Date())

// Calcula uma data futura em dias corridos e retorna no formato AAAA-MM-DD.
export const addDays = days => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return ymd(date)
}

// Calcula uma data futura a partir de outra data no formato AAAA-MM-DD.
export const addDaysTo = (value, days) => {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return ymd(date)
}

// Mede a diferença em dias entre hoje e uma data de devolução.
export const diff = date => Math.round((new Date(`${date}T00:00`) - new Date(`${today()}T00:00`)) / 864e5)

// Mede dias entre duas datas sem envolver o fuso horário local.
export const diffFrom = (start, end) => Math.round(
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5,
)

// Converte AAAA-MM-DD para o formato brasileiro DD/MM/AAAA.
export const fmt = date => (date ? date.split('-').reverse().join('/') : '')

// Compara texto de busca ignorando diferenças entre maiúsculas e acentos.
export const normalizarBusca = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')

export const correspondeBusca = (termo, ...valores) => {
  const busca = normalizarBusca(termo).trim()
  return !busca || valores.some(valor => normalizarBusca(valor).includes(busca))
}

// Converte valores de data em objetos Date, aceitando YYYY-MM-DD e timestamps do Firebase.
export function paraData(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value === 'string') {
    const texto = value.trim()
    if (!texto) return null
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? `${texto}T00:00:00` : texto
    const data = new Date(iso)
    return Number.isNaN(data.getTime()) ? null : data
  }
  return null
}

// Exibe datas completas com hora quando o valor contém um horário.
export function fmtDataHora(value) {
  const date = paraData(value)
  if (!date) return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return fmt(value)
  return date.toLocaleString('pt-BR')
}

// Calcula a duração entre duas datas em dias, horas, minutos e segundos.
export function tempoEmprestimo(inicio, fim) {
  const inicioDate = paraData(inicio)
  const fimDate = paraData(fim)
  if (!inicioDate || !fimDate) return '—'

  let totalSegundos = Math.floor(Math.max(0, fimDate - inicioDate) / 1000)
  const dias = Math.floor(totalSegundos / 86400)
  totalSegundos %= 86400
  const horas = Math.floor(totalSegundos / 3600)
  totalSegundos %= 3600
  const minutos = Math.floor(totalSegundos / 60)
  const segundos = totalSegundos % 60
  return `${dias} dia(s), ${horas} hora(s), ${minutos} minuto(s) e ${segundos} segundo(s)`
}

// Conta o tempo restante até o fim do dia de devolução, ou o atraso acumulado.
export function tempoRestante(devolucao, agora = new Date()) {
  if (!devolucao) return '—'
  const limite = new Date(`${devolucao}T23:59:59`)
  if (Number.isNaN(limite.getTime())) return '—'

  const diferenca = limite.getTime() - agora.getTime()
  let segundosTotais = Math.floor(Math.abs(diferenca) / 1000)
  const dias = Math.floor(segundosTotais / 86400)
  segundosTotais %= 86400
  const horas = Math.floor(segundosTotais / 3600)
  segundosTotais %= 3600
  const minutos = Math.floor(segundosTotais / 60)
  const segundos = segundosTotais % 60
  const duracao = [
    `${dias} ${dias === 1 ? 'dia' : 'dias'}`,
    `${horas} ${horas === 1 ? 'hora' : 'horas'}`,
    `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`,
    `${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}`,
  ].join(', ')

  return diferenca > 0 ? `Faltam ${duracao}` : `Atrasado há ${duracao}`
}

// Indica se o empréstimo ainda está reservado ou com o produto emprestado.
export const ativo = loan => loan.status === 'reservado' || loan.status === 'emprestado'

// Retorna os períodos públicos, sem dados pessoais ou códigos dos empréstimos.
export function periodosItem(db, itemId) {
  const availability = db.availability?.find(item => item.id === itemId)
  if (availability) return [...(availability.periods || [])]
    .sort((left, right) => left.inicio.localeCompare(right.inicio))
  return db.loans
    .filter(loan => loan.itemId === itemId && ativo(loan))
    .map(loan => ({
      inicio: loan.inicio || loan.criado || today(),
      devolucao: loan.devolucao,
      status: loan.status,
    }))
}

// Retorna a reserva ou o empréstimo que cobre a data consultada.
export const periodoAtualItem = (db, itemId, date = today()) => periodosItem(db, itemId)
  .find(period => period.inicio <= date && period.devolucao >= date)

// Permite reservar a partir do primeiro dia após todos os períodos já agendados.
export function inicioDisponivelItem(db, itemId) {
  const futurePeriods = periodosItem(db, itemId)
    .filter(period => period.devolucao >= today())
  if (futurePeriods.length === 0) return today()
  const lastReturn = futurePeriods.reduce(
    (latest, period) => period.devolucao > latest ? period.devolucao : latest,
    futurePeriods[0].devolucao,
  )
  return addDaysTo(lastReturn, 1)
}

// Confere se o produto não tem empréstimo nem reserva futura ativa.
export const itemLivre = (db, itemId) => periodosItem(db, itemId).length === 0

// Procura o nome do produto associado a um empréstimo.
export const itemNome = (db, itemId) => db.items.find(item => item.id === itemId)?.nome ?? '(removido)'

// Cria um código legível, sem letras e números que costumam ser confundidos.
export function gerarCodigo(db, usados = []) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bloqueados = new Set([
    ...(Array.isArray(usados) ? usados : [usados]),
    ...((db?.loans || []).flatMap(loan => [loan.codigo, loan.codigoEntrega].filter(Boolean))),
  ])

  let code
  do {
    code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('')
  } while (bloqueados.has(code))
  return code
}

// Normaliza e-mails para comparar empréstimos antigos com a conta atual.
export const normContato = contact => contact.trim().toLowerCase()

// Seleciona empréstimos que vencem dentro do prazo de aviso configurado.
export const lembretes = db => db.loans
  .filter(loan => loan.status === 'emprestado' && diff(loan.devolucao) <= db.cfg.diasAviso)
  .map(loan => ({ ...loan, dias: diff(loan.devolucao) }))

// Produz uma frase curta para o prazo de devolução.
export const quando = days => (days < 0
  ? `atrasado há ${-days} dia(s)`
  : days === 0
    ? 'vence hoje'
    : days === 1
      ? 'vence amanhã'
      : `vence em ${days} dias`)

// Abre o cliente de e-mail padrão com o lembrete preenchido.
export function linkEmail(db, loan, agora = new Date()) {
  const codigoDevolucao = loan.codigoEntrega || loan.codigo || 'não informado'
  const subject = 'Lembrete de devolução - ESTEAMULAB'
  const body = [
    `Olá, ${loan.nome || 'usuário'}!`,
    '',
    `Este é um lembrete do ESTEAMULAB: a devolução de "${itemNome(db, loan.itemId)}"`,
    `está prevista para ${fmt(loan.devolucao)} (${quando(loan.dias ?? diff(loan.devolucao))}).`,
    `Tempo restante para entrega: ${tempoRestante(loan.devolucao, agora)}.`,
    `Código de devolução: ${codigoDevolucao}.`,
    '',
    'Atenciosamente,',
    'Equipe ESTEAMULAB',
  ].join('\n')
  const to = String(loan.contato || '').trim()
  const params = new URLSearchParams({ subject, body })
  return `mailto:${to}?${params.toString()}`
}

// Monta o link do WhatsApp para usuários sem endereço de e-mail.
export function linkContato(db, loan) {
  const codigoDevolucao = loan.codigoEntrega || loan.codigo
  const message = `Olá, ${loan.nome}! Lembrete do ESTEAMULAB: a devolução de "${itemNome(db, loan.itemId)}" ${quando(loan.dias ?? diff(loan.devolucao))} (${fmt(loan.devolucao)}). Código de devolução: ${codigoDevolucao}.`
  const phone = String(loan.contato || '').replace(/\D/g, '')
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

// Apresenta o status do empréstimo com as cores padronizadas do Bootstrap.
const statusClasses = {
  reservado: 'warning text-dark',
  emprestado: 'primary',
  devolvido: 'success',
  cancelado: 'secondary',
}

export function Status({ s }) {
  return <span className={`badge text-bg-${statusClasses[s] || 'secondary'}`}>{s}</span>
}
