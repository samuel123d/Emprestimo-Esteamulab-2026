// Envia fotos dos produtos ao Firebase Storage e devolve os dados para o Firestore.
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { auth, storage } from './firebase.js'

const MAX_SOURCE_PHOTO_SIZE = 20 * 1024 * 1024
const MAX_PHOTO_SIZE = 5 * 1024 * 1024
const MAX_PHOTO_DIMENSION = 1600
const COMPRESS_PHOTO_SIZE = 1024 * 1024
const UPLOAD_IDLE_TIMEOUT = 60 * 1000
const IMAGE_PREPARATION_TIMEOUT = 30 * 1000

function withTimeout(promise, timeout, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function decodePhoto(file) {
  const bitmapPromise = createImageBitmap(file)
  try {
    return await withTimeout(
      bitmapPromise,
      IMAGE_PREPARATION_TIMEOUT,
      'A imagem não pôde ser preparada em 30 segundos. Escolha outra foto em JPG ou PNG.',
    )
  } catch (error) {
    bitmapPromise.then(bitmap => bitmap.close()).catch(() => {})
    throw error
  }
}

// Reduz fotos grandes antes do envio para evitar uploads lentos em celulares.
async function prepareProductPhoto(file, onProgress) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.')
  }
  if (file.size > MAX_SOURCE_PHOTO_SIZE) {
    throw new Error('A imagem original deve ter no máximo 20 MB.')
  }

  onProgress(0, 0, file.size, 'preparing')
  const bitmap = await decodePhoto(file)
  try {
    const largestDimension = Math.max(bitmap.width, bitmap.height)
    if (file.size <= COMPRESS_PHOTO_SIZE && largestDimension <= MAX_PHOTO_DIMENSION) {
      return file
    }

    const scale = Math.min(1, MAX_PHOTO_DIMENSION / largestDimension)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a imagem para envio.')

    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const compressed = await withTimeout(
      new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82)),
      IMAGE_PREPARATION_TIMEOUT,
      'A conversão da imagem demorou demais. Escolha uma foto menor e tente novamente.',
    )
    if (!compressed) throw new Error('Não foi possível preparar a imagem para envio.')
    if (compressed.size > MAX_PHOTO_SIZE) {
      throw new Error('Não foi possível reduzir a imagem para menos de 5 MB.')
    }

    return new File([compressed], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close()
  }
}

// Valida e envia uma imagem para uma pasta exclusiva do administrador atual.
export async function uploadProductPhoto(file, productId, onProgress = () => {}) {
  if (!auth.currentUser) {
    throw new Error('Entre novamente para enviar a foto.')
  }

  const photo = await prepareProductPhoto(file, onProgress)
  const path = `products/${auth.currentUser.uid}/${productId}-${Date.now()}`
  const photoRef = ref(storage, path)
  const upload = uploadBytesResumable(photoRef, photo, { contentType: photo.type })

  try {
    onProgress(0, 0, photo.size, 'connecting')
    await new Promise((resolve, reject) => {
      let lastBytesTransferred = 0
      let idleTimer
      const unsubscribe = upload.on('state_changed', snapshot => {
        onProgress(
          Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
          snapshot.bytesTransferred,
          snapshot.totalBytes,
          'uploading',
        )
        if (snapshot.bytesTransferred > lastBytesTransferred) {
          lastBytesTransferred = snapshot.bytesTransferred
          clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            unsubscribe()
            upload.cancel()
            reject(new Error('O envio ficou sem progresso por 60 segundos. Verifique a conexão e as configurações do Firebase Storage e tente novamente.'))
          }, UPLOAD_IDLE_TIMEOUT)
        }
      }, error => {
        clearTimeout(idleTimer)
        unsubscribe()
        reject(error)
      }, () => {
        clearTimeout(idleTimer)
        unsubscribe()
        resolve()
      })
      idleTimer = setTimeout(() => {
        unsubscribe()
        upload.cancel()
        reject(new Error('O envio não começou após 60 segundos. Verifique a conexão, as regras do Storage e a variável VITE_FIREBASE_STORAGE_BUCKET.'))
      }, UPLOAD_IDLE_TIMEOUT)
    })

    return {
      photoUrl: await getDownloadURL(photoRef),
      photoPath: path,
    }
  } catch (error) {
    const messages = {
      'storage/unauthorized': 'O Firebase Storage negou o envio. Confira se a conta tem perfil admin e se as regras do Storage estão publicadas.',
      'storage/unauthenticated': 'Sua sessão expirou. Entre novamente e tente enviar a foto.',
      'storage/bucket-not-found': 'O bucket do Firebase Storage não foi encontrado. Confira VITE_FIREBASE_STORAGE_BUCKET.',
      'storage/object-not-found': 'O bucket ou o arquivo não foi encontrado. Confira VITE_FIREBASE_STORAGE_BUCKET e habilite o Cloud Storage no projeto Firebase.',
      'storage/unknown': 'O Firebase Storage não respondeu corretamente. Confira se o bucket existe no mesmo projeto definido em VITE_FIREBASE_PROJECT_ID e tente novamente.',
      'storage/retry-limit-exceeded': 'O Firebase Storage não conseguiu concluir o envio após várias tentativas. Verifique sua conexão.',
    }
    if (messages[error.code]) throw new Error(messages[error.code])
    throw error
  }
}

// Remove a foto do Storage quando o produto que a utiliza for apagado.
export async function deleteProductPhoto(path) {
  if (path) await deleteObject(ref(storage, path))
}
