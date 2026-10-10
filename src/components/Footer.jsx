export default function Footer({ profile, onCreatorClick }) {
  return (
    <>
      {profile && (
        <footer className="site-partners">
          <div className="institutional-label">REALIZAÇÃO E PARCERIA</div>
          <div className="institutional-logo-row">
            <img className="logo-ufrn" src="/logos/ufrn.png" alt="Universidade Federal do Rio Grande do Norte" />
            <img className="logo-giife" src="/logos/giife.png" alt="GIIfE" />
            <img className="logo-imd" src="/logos/imd.png" alt="Instituto Metrópole Digital" />
          </div>
        </footer>
      )}
      <footer className="site-footer">
        <div className="creator-credit-wrap">
          <div className="creator-credit" onClick={onCreatorClick}>
            <img src="/creator/samuel.webp" alt="Samuel Anderson Machado Lopes, criador do site" />
            <span><strong>Samuel Anderson Machado Lopes</strong><small>Criador do site</small></span>
          </div>
        </div>
        <span>© {new Date().getFullYear()} ESTEAMULAB · Direitos reservados ao ESTEAMULAB e a <a href="https://samuel123d.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Samuel Anderson Machado Lopes</a>.</span>
        <span>Um espaço para pensar, criar e inovar.</span>
      </footer>
    </>
  )
}
