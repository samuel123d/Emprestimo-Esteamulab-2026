// Funções de autenticação e perfil, separadas dos componentes de tela.
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, firestore } from './firebase.js'

// Guarda temporariamente o login Google pendente quando o e-mail já tem senha.
let pendingGoogleCredential = null
let pendingGoogleEmail = null

// Garante que uma conta autenticada tenha perfil comum sem alterar perfis existentes.
export async function ensureUserProfile(user) {
  const profileRef = doc(firestore, 'users', user.uid)
  const profile = await getDoc(profileRef)
  if (profile.exists()) return profile.data()

  const newProfile = {
    name: user.displayName || '',
    email: user.email || '',
    role: 'user',
    createdAt: new Date().toISOString(),
  }
  await setDoc(profileRef, newProfile)
  return newProfile
}

// Cria uma conta de usuário comum usando e-mail e senha informados no site.
export async function registerUser({ name, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
  await updateProfile(credential.user, { displayName: name.trim() })
  await ensureUserProfile({
    uid: credential.user.uid,
    displayName: name.trim(),
    email: credential.user.email,
  })
  return credential.user
}

// Autentica uma conta que já existe no Firebase Authentication.
export async function loginUser({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)

  // Vincula o Google à conta existente depois que a pessoa confirma sua senha.
  if (pendingGoogleCredential && pendingGoogleEmail === credential.user.email?.toLowerCase()) {
    await linkWithCredential(credential.user, pendingGoogleCredential)
    pendingGoogleCredential = null
    pendingGoogleEmail = null
  }

  // Contas criadas pelo Console Authentication ganham perfil comum na primeira entrada.
  await ensureUserProfile(credential.user)

  return credential.user
}

// Confirma que as credenciais usadas na área administrativa têm o papel admin.
export async function loginAdmin(credentials) {
  const user = await loginUser(credentials)
  const profile = await getDoc(doc(firestore, 'users', user.uid))

  if (profile.data()?.role !== 'admin') {
    await signOut(auth)
    const error = new Error('Esta conta não tem acesso de administrador.')
    error.code = 'app/not-admin'
    throw error
  }

  return user
}

// Autentica com Google e cria um perfil comum se for a primeira entrada no app.
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider()
  let credential
  try {
    credential = await signInWithPopup(auth, provider)
  } catch (error) {
    // Mantém a credencial para concluir a vinculação após login por e-mail e senha.
    if (error.code === 'auth/account-exists-with-different-credential') {
      pendingGoogleCredential = GoogleAuthProvider.credentialFromError(error)
      pendingGoogleEmail = error.customData?.email?.toLowerCase() || null
    }
    throw error
  }
  await ensureUserProfile(credential.user)

  return credential.user
}

// Expõe as mudanças de sessão para o app e devolve a função de cancelamento.
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback)
}

// Encerra a sessão atual do Firebase.
export function logoutUser() {
  pendingGoogleCredential = null
  pendingGoogleEmail = null
  return signOut(auth)
}

// Envia ao usuário um link seguro para redefinir a senha.
export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email.trim().toLowerCase())
}
