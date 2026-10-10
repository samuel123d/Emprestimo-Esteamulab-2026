const MAX_PHOTO_SIZE = 20 * 1024 * 1024
const MAX_STORED_DATA_URL_SIZE = 700 * 1024
const MAX_DIMENSION = 1280

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Não foi possível preparar a foto selecionada.'))
    reader.readAsDataURL(blob)
  })
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Seu navegador não conseguiu otimizar esta imagem.'))
    }, 'image/jpeg', quality)
  })
}

// Segue o fluxo do S4Solution: a foto é salva como Data URL no próprio documento Firestore.
// A compressão mantém o tamanho do documento abaixo do limite do Firestore.
export async function uploadProductPhoto(file, _productId, onProgress = () => {}) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Escolha um arquivo PNG, JPEG, WebP ou outra imagem compatível.')
  }
  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error('A imagem original deve ter no máximo 20 MB.')
  }

  onProgress(10, 0, file.size, 'preparing')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Não foi possível abrir essa imagem. Tente um arquivo PNG, JPEG ou WebP.')
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Seu navegador não conseguiu preparar a foto.')

    // Mantém imagens PNG transparentes legíveis após a conversão para JPEG.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    let blob
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      blob = await canvasToJpeg(canvas, quality)
      if (blob.size <= MAX_STORED_DATA_URL_SIZE) break
    }
    if (!blob || blob.size > MAX_STORED_DATA_URL_SIZE) {
      throw new Error('A foto ainda ficou grande após a compressão. Escolha uma imagem menor.')
    }

    onProgress(90, blob.size, blob.size, 'saving')
    const photoUrl = await readAsDataUrl(blob)
    onProgress(100, blob.size, blob.size, 'saving')
    return { photoUrl }
  } finally {
    bitmap.close?.()
  }
}
