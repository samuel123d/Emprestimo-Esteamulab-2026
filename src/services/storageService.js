// Envia fotos dos produtos ao Firebase Storage e devolve os dados para o Firestore.
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, storage } from './firebase.js'

const MAX_PHOTO_SIZE = 5 * 1024 * 1024

// Valida e envia uma imagem para uma pasta exclusiva do administrador atual.
export async function uploadProductPhoto(file, productId) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.')
  }
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error('A foto deve ter no máximo 5 MB.')
  }
  if (!auth.currentUser) {
    throw new Error('Entre novamente para enviar a foto.')
  }

  const path = `products/${auth.currentUser.uid}/${productId}-${Date.now()}`
  const photoRef = ref(storage, path)
  await uploadBytes(photoRef, file, { contentType: file.type })

  return {
    photoUrl: await getDownloadURL(photoRef),
    photoPath: path,
  }
}

// Remove a foto do Storage quando o produto que a utiliza for apagado.
export async function deleteProductPhoto(path) {
  if (path) await deleteObject(ref(storage, path))
}
