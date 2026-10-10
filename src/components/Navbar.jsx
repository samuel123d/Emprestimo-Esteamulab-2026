export default function Navbar({ profile, onLogout }) {
  return (
    <nav className="navbar navbar-dark mb-4 site-navbar">
      <div className="container">
        <span className="navbar-brand fw-semibold">
          <img className="navbar-logo" src="/logos/esteamulab-logo.png" alt="ESTEAMULAB — Espaço para pensar, criar e inovar" />
        </span>
        {profile && (
          <span className="text-white-50 small d-flex align-items-center gap-3">
            <span>{profile.nome} ({profile.role === 'admin' ? 'administrador' : 'usuário'})</span>
            <button className="btn btn-sm btn-outline-light" onClick={onLogout}>Sair</button>
          </span>
        )}
      </div>
    </nav>
  )
}
