// Acesso ao Firestore: observação em tempo real e persistência das mudanças do app.
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { firestore } from './firebase.js'

// Converte uma coleção de documentos em objetos que mantêm o ID usado pela interface.
function subscribeCollection(name, onData, onError, constraints = []) {
  const source = query(collection(firestore, name), ...constraints)
  return onSnapshot(source, snapshot => {
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, error => {
    onError(new Error(`Coleção "${name}": ${error.message}`, { cause: error }))
  })
}

// Mantém os produtos e empréstimos sincronizados; usuários só são listados por administradores.
export function subscribeToAppData({ uid, isAdmin, onChange, onError }) {
  const state = { items: [], loans: [], availability: [], users: [], cfg: { diasAviso: 1, maxDias: 30 } }
  const ready = { items: false, loans: false, availability: false, users: !isAdmin, cfg: false }
  const publish = () => onChange({
    ...state,
    items: [...state.items],
    loans: [...state.loans],
    availability: [...state.availability],
    users: [...state.users],
    ready: {
      ...ready,
      all: Object.values(ready).every(Boolean),
    },
  })
  const stop = []

  stop.push(subscribeCollection('items', value => {
    state.items = value
    ready.items = true
    publish()
  }, onError))
  stop.push(subscribeCollection(
    'itemAvailability',
    value => {
      state.availability = value
      ready.availability = true
      publish()
    },
    onError,
  ))
  const loanFilter = isAdmin ? [] : [where('userId', '==', uid)]
  stop.push(subscribeCollection('loans', value => {
    state.loans = value
    ready.loans = true
    publish()
  }, onError, loanFilter))

  if (isAdmin) stop.push(subscribeCollection('users', value => {
    // Mantém os nomes de campos esperados pelas telas legadas do painel.
    state.users = value.map(user => ({ ...user, nome: user.name, contato: user.email }))
    ready.users = true
    publish()
  }, onError))

  stop.push(onSnapshot(doc(firestore, 'settings', 'app'), snapshot => {
    state.cfg = { diasAviso: 1, maxDias: 30, ...(snapshot.exists() ? snapshot.data() : {}) }
    ready.cfg = true
    publish()
  }, error => {
    onError(new Error('Documento "settings/app": ' + error.message, { cause: error }))
  }))

  // Para todas as inscrições, devolve um único cancelador.
  return () => stop.forEach(unsubscribe => unsubscribe())
}

export async function createLoanReservation({ itemId, inicio, devolucao, user }) {
  const loanRef = doc(collection(firestore, 'loans'))
  const availabilityRef = doc(firestore, 'itemAvailability', itemId)
  const itemRef = doc(firestore, 'items', itemId)
  const userRef = doc(firestore, 'users', user.id)
  const code = generateCode()
  const deliveryCode = generateCode(code)
  const loan = {
    itemId,
    userId: user.id,
    nome: user.nome,
    contato: user.contato,
    inicio,
    devolucao,
    codigo: code,
    codigoEntrega: deliveryCode,
    status: 'reservado',
    criado: new Date().toISOString().slice(0, 10),
  }

  await runTransaction(firestore, async transaction => {
    const [itemSnapshot, userSnapshot, availabilitySnapshot] = await Promise.all([
      transaction.get(itemRef),
      transaction.get(userRef),
      transaction.get(availabilityRef),
    ])
    if (!itemSnapshot.exists()) throw new Error('Este produto não existe mais.')
    if (!userSnapshot.exists() || userSnapshot.data().role !== 'user') {
      throw new Error('Seu perfil não permite criar reservas.')
    }

    const periods = availabilitySnapshot.exists()
      ? availabilitySnapshot.data().periods || []
      : []
    if (periods.some(period => inicio <= period.devolucao && devolucao >= period.inicio)) {
      const conflict = new Error('Esse período já foi reservado. Escolha outras datas.')
      conflict.code = 'reservation-conflict'
      throw conflict
    }

    transaction.set(loanRef, loan)
    transaction.set(availabilityRef, {
      periods: [...periods, {
        loanId: loanRef.id,
        inicio,
        devolucao,
        status: 'reservado',
      }],
      updatedAt: new Date().toISOString(),
    })
  })
  return { id: loanRef.id, ...loan }
}

export async function syncItemAvailability(loans, items) {
  const periodsByItem = new Map()
  for (const item of items) periodsByItem.set(item.id, [])
  for (const loan of loans) {
    if (loan.status !== 'reservado' && loan.status !== 'emprestado') continue
    const periods = periodsByItem.get(loan.itemId) || []
    periods.push({
      loanId: loan.id,
      inicio: loan.inicio || loan.retirado?.slice(0, 10) || loan.criado,
      devolucao: loan.devolucao,
      status: loan.status,
    })
    periodsByItem.set(loan.itemId, periods)
  }

  const existing = await getDocs(collection(firestore, 'itemAvailability'))
  const operations = []
  for (const [itemId, periods] of periodsByItem) {
    operations.push({type: 'set', ref: doc(firestore, 'itemAvailability', itemId), data: {
      periods: periods.sort((left, right) => left.inicio.localeCompare(right.inicio)),
      updatedAt: new Date().toISOString(),
    }})
  }
  for (const snapshot of existing.docs) {
    if (!periodsByItem.has(snapshot.id)) {
      operations.push({type: 'delete', ref: doc(firestore, 'itemAvailability', snapshot.id)})
    }
  }
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(firestore)
    for (const operation of operations.slice(offset, offset + 450)) {
      if (operation.type === 'set') batch.set(operation.ref, operation.data)
      else batch.delete(operation.ref)
    }
    await batch.commit()
  }
}

function generateCode(excluded = '') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (code === excluded)
  return code
}

// Persiste um produto antes de confirmar o cadastro na interface.
export async function saveProduct(item) {
  const { id, ...data } = item
  await setDoc(doc(firestore, 'items', id), data)
}

// Remove um produto diretamente para que o painel confirme a exclusao real no Firestore.
export async function deleteProduct(id) {
  await deleteDoc(doc(firestore, 'items', id))
}

// Confirma o avanço de status do empréstimo diretamente no Firestore.
export async function confirmLoanStatus(id, status, timestampField, timestamp) {
  if (status === 'emprestado') {
    const loanRef = doc(firestore, 'loans', id)
    await runTransaction(firestore, async transaction => {
      const loanSnapshot = await transaction.get(loanRef)
      if (!loanSnapshot.exists()) throw new Error('Este empréstimo não existe mais.')
      const loan = loanSnapshot.data()
      const availabilityRef = doc(firestore, 'itemAvailability', loan.itemId)
      const availabilitySnapshot = await transaction.get(availabilityRef)
      const periods = availabilitySnapshot.exists()
        ? availabilitySnapshot.data().periods || []
        : []
      if (periods.some(period => period.status === 'emprestado' && period.loanId !== id)) {
        const conflict = new Error('Este produto já está emprestado.')
        conflict.code = 'item-already-loaned'
        throw conflict
      }

      const periodIndex = periods.findIndex(period => period.loanId === id)
      const updatedPeriods = [...periods]
      const loanPeriod = {
        loanId: id,
        inicio: loan.inicio || loan.retirado?.slice(0, 10) || loan.criado,
        devolucao: loan.devolucao,
        status: 'emprestado',
      }
      if (periodIndex >= 0) updatedPeriods[periodIndex] = loanPeriod
      else updatedPeriods.push(loanPeriod)

      transaction.update(loanRef, {
        status,
        [timestampField]: timestamp,
      })
      transaction.set(availabilityRef, {
        periods: updatedPeriods,
        updatedAt: new Date().toISOString(),
      })
    })
    return
  }

  await updateDoc(doc(firestore, 'loans', id), {
    status,
    [timestampField]: timestamp,
  })
}

// Persiste diferenças do estado local sem substituir coleções inteiras no banco.
export async function persistDbChanges(previous, next) {
  const writes = []

  for (const key of ['items', 'loans', 'users']) {
    const before = new Map((previous[key] || []).map(item => [item.id, item]))
    const after = new Map((next[key] || []).map(item => [item.id, item]))

    for (const [id, item] of after) {
      if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) {
        const { id: documentId, ...data } = item
        writes.push(setDoc(doc(firestore, key, documentId), data))
      }
    }

    for (const id of before.keys()) {
      if (!after.has(id)) writes.push(deleteDoc(doc(firestore, key, id)))
    }
  }

  if (JSON.stringify(previous.cfg) !== JSON.stringify(next.cfg)) {
    writes.push(setDoc(doc(firestore, 'settings', 'app'), next.cfg))
  }

  await Promise.all(writes)
}
