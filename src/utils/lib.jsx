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

// Mede a diferença em dias entre hoje e uma data de devolução.
export const diff = date => Math.round((new Date(`${date}T00:00`) - new Date(`${today()}T00:00`)) / 864e5)

// Converte AAAA-MM-DD para o formato brasileiro DD/MM/AAAA.
export const fmt = date => (date ? date.split('-').reverse().join('/') : '')

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

// Indica se o empréstimo ainda está reservado ou com o produto emprestado.
export const ativo = loan => loan.status === 'reservado' || loan.status === 'emprestado'

// Confere se não existe empréstimo ativo para o produto informado.
export const itemLivre = (db, itemId) => !db.loans.some(loan => loan.itemId === itemId && ativo(loan))

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
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
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

// Monta o link de contato adequado para enviar um lembrete ao usuário.
export function linkContato(db, loan) {
  const codigoDevolucao = loan.codigoEntrega || loan.codigo
  const message = `Olá, ${loan.nome}! Lembrete do ESTEAMULAB: a devolução de "${itemNome(db, loan.itemId)}" ${quando(loan.dias ?? diff(loan.devolucao))} (${fmt(loan.devolucao)}). Código de devolução: ${codigoDevolucao}.`
  const encodedMessage = encodeURIComponent(message)
  return `mailto:${loan.contato}?subject=${encodeURIComponent('Lembrete de devolução - ESTEAMULAB')}&body=${encodedMessage}`
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
