export default function LoadingState({ label = 'Carregando dados...' }) {
  return (
    <div className="local-loading" role="status" aria-live="polite">
      <span className="spinner-border spinner-border-sm text-primary" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
