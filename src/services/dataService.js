// Acesso ao Firestore: observação em tempo real e persistência das mudanças do app.
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { firestore } from './firebase.js'

// Converte uma coleção de documentos em objetos que mantêm o ID usado pela interface.
function subscribeCollection(name, onData, onError, constraints = []) {
  const source = query(collection(firestore, name), ...constraints)
  return onSnapshot(source, snapshot => {
    onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
  }, onError)
}

// Mantém os produtos e empréstimos sincronizados; usuários só são listados por administradores.
export function subscribeToAppData({ uid, isAdmin, onChange, onError }) {
  const state = { items: [], loans: [], users: [], cfg: { diasAviso: 1, maxDias: 30 } }
  const publish = () => onChange({ ...state, items: [...state.items], loans: [...state.loans], users: [...state.users] })
  const stop = []

  stop.push(subscribeCollection('items', value => { state.items = value; publish() }, onError))
  const loanFilter = isAdmin ? [] : [where('userId', '==', uid)]
  stop.push(subscribeCollection('loans', value => { state.loans = value; publish() }, onError, loanFilter))

  if (isAdmin) stop.push(subscribeCollection('users', value => {
    // Mantém os nomes de campos esperados pelas telas legadas do painel.
    state.users = value.map(user => ({ ...user, nome: user.name, contato: user.email }))
    publish()
  }, onError))

  stop.push(onSnapshot(doc(firestore, 'settings', 'app'), snapshot => {
    state.cfg = { diasAviso: 1, maxDias: 30, ...(snapshot.exists() ? snapshot.data() : {}) }
    publish()
  }, onError))

  // Para todas as inscrições, devolve um único cancelador.
  return () => stop.forEach(unsubscribe => unsubscribe())
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
