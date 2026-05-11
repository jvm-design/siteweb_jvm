# Siteweb JVM

Site personnel statique — HTML + CSS vanilla, zéro framework.

## Structure

```
site/
├── index.html              Page d'accueil
├── pages/
│   ├── about.html          À propos
│   ├── work.html           Projets
│   └── contact.html        Contact
├── assets/
│   ├── css/
│   │   ├── reset.css       Reset CSS moderne
│   │   └── styles.css      Styles du site (variables, layout, typo)
│   ├── js/main.js          JS minimal (état actif nav)
│   ├── img/                Images du site
│   └── fonts/              Fontes custom (si besoin)
└── package.json
```

## Lancer en local

Avec live-reload (recommandé) :

```bash
npm run dev
```

Ou sans rien installer :

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765.

## Où modifier quoi

- **Couleurs, typo, tailles** : variables CSS en haut de `assets/css/styles.css` (`:root { ... }`).
- **Contenu des pages** : directement dans les fichiers `.html`. Le texte est en français avec "Jaime Villegas Maira" comme nom placeholder — remplace partout.
- **Nav** : présente dans chaque page (bloc `<nav class="site-nav">`). Si tu ajoutes une page, ajoute le lien dans les 4 fichiers HTML.
- **Mode sombre** : automatique via `prefers-color-scheme` (voir `styles.css`).

## Notes

- `../nelson-base/` contient le mirroir du site nelson.co — sert de référence visuelle, ne pas publier (contenu sous droits d'auteur de Gavin Nelson).
- Les chemins dans `pages/*.html` utilisent `../` pour remonter à `assets/` et `index.html`.
