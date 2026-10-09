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

// Indica se o empréstimo ainda está reservado ou com o produto emprestado.
export const ativo = loan => loan.status === 'reservado' || loan.status === 'emprestado'

// Confere se não existe empréstimo ativo para o produto informado.
export const itemLivre = (db, itemId) => !db.loans.some(loan => loan.itemId === itemId && ativo(loan))

// Procura o nome do produto associado a um empréstimo.
export const itemNome = (db, itemId) => db.items.find(item => item.id === itemId)?.nome ?? '(removido)'

// Cria um código legível, sem letras e números que costumam ser confundidos.
export function gerarCodigo(db) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (db.loans.some(loan => loan.codigo === code))
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
  const message = `Olá, ${loan.nome}! Lembrete do ESTEAMULAB: a devolução de "${itemNome(db, loan.itemId)}" ${quando(loan.dias ?? diff(loan.devolucao))} (${fmt(loan.devolucao)}). Código de devolução: ${loan.codigo}.`
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
