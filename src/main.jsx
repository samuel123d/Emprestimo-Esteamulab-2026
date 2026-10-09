// Carrega os estilos globais e monta o componente principal do React no HTML.
import React from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './styles.css'

const root = createRoot(document.getElementById('root'))
const requiredFirebaseVariables = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]
const missingFirebaseVariables = requiredFirebaseVariables.filter(
  variable => !import.meta.env[variable],
)

if (missingFirebaseVariables.length) {
  root.render(
    <main className="container py-5">
      <div className="alert alert-danger" role="alert">
        <h1 className="h5">Configuração do Firebase incompleta</h1>
        <p>Cadastre estas variáveis nas configurações do projeto no Vercel e gere um novo deploy:</p>
        <ul className="mb-0">
          {missingFirebaseVariables.map(variable => <li key={variable}><code>{variable}</code></li>)}
        </ul>
      </div>
    </main>,
  )
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(<App />)
  }).catch(error => {
    console.error('Não foi possível iniciar o aplicativo.', error)
    const invalidApiKey = error?.code === 'auth/invalid-api-key'
    const detail = error instanceof Error ? error.message : String(error)

    root.render(
      <main className="container py-5">
        <div className="alert alert-danger" role="alert">
          <h1 className="h5">Não foi possível iniciar o aplicativo</h1>
          {invalidApiKey ? (
            <>
              <p>A chave da API Firebase configurada para este deploy é inválida.</p>
              <p className="mb-0">
                No Vercel, confira <code>VITE_FIREBASE_API_KEY</code> nas variáveis de ambiente
                do ambiente publicado, usando a chave do app Web Firebase, e faça um novo deploy.
              </p>
            </>
          ) : (
            <p className="mb-0">Erro ao carregar o aplicativo: <code>{detail}</code></p>
          )}
        </div>
      </main>,
    )
  })
}
