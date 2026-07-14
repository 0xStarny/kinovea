# kinovea.be

Site multi-cabinets Kinovea : landing page + 3 sites.

## Structure

```
├── index.html            → landing page
├── assets/               → logo + photos de fond (landing)
├── lasne/index.html      → site Lasne
├── rhode/index.html      → site Rhode-Saint-Genèse
├── kraainem/index.html   → site Kraainem
└── vercel.json           → routage des sous-domaines (pour plus tard)
```

**Tous les liens internes sont relatifs** : le site est entièrement navigable dès le premier déploiement, sans domaine — sur l'URL Vercel par défaut (`https://<projet>.vercel.app`), la landing est à la racine et les sites sur `/lasne/`, `/rhode/`, `/kraainem/`. Ça marche aussi en ouvrant `index.html` en local.

## Déploiement sur Vercel

1. Pousser ce dossier dans un repo GitHub (branche `main`).
2. Sur [vercel.com](https://vercel.com) → **Add New Project** → importer le repo.
   - Framework Preset : **Other**
   - Build Command : *(vide)* — site statique, rien à builder
   - Output Directory : *(vide / racine)*
3. Déployer. C'est tout — le site est utilisable immédiatement sur l'URL `*.vercel.app`.

## Domaines (plus tard)

Le `vercel.json` est déjà prêt : dès que les domaines seront liés, `lasne.kinovea.be` servira `/lasne`, etc., et `kinovea.be/lasne` redirigera vers le sous-domaine. Rien à modifier dans le code ce jour-là.

Dans le projet Vercel → **Settings → Domains**, ajouter les 4 domaines :

| Domaine | DNS chez votre registrar |
|---|---|
| `kinovea.be` | Enregistrement **A** → `76.76.21.21` |
| `lasne.kinovea.be` | **CNAME** → `cname.vercel-dns.com` |
| `rhode.kinovea.be` | **CNAME** → `cname.vercel-dns.com` |
| `kraainem.kinovea.be` | **CNAME** → `cname.vercel-dns.com` |

(Ou plus simple : déléguer les nameservers du domaine à Vercel, qui configure tout automatiquement. Vercel affiche les valeurs exactes à utiliser au moment d'ajouter chaque domaine.)

Optionnel : ajouter aussi `www.kinovea.be` et le rediriger vers `kinovea.be` (Vercel le propose en un clic).

Le HTTPS est automatique (certificats émis par Vercel pour chaque domaine).

## Mise à jour d'un site

Remplacer le `index.html` du dossier concerné (`lasne/`, `rhode/` ou `kraainem/`) et pousser sur `main` — Vercel redéploie automatiquement.

Note : les liens croisés entre cabinets dans les 3 sites pointent déjà vers les nouveaux sous-domaines `*.kinovea.be`.
