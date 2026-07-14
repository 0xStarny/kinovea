# Kinovea — Prise de rendez-vous (powered by KineQuick)

## Contexte

Le cabinet Kinovea (Lasne, Rhode-Saint-Genèse, + visites à domicile par région) utilise KineQuick
comme backend de gestion d'agenda (`root=kq43414`). La prise de RDV en ligne actuelle se fait via
le widget générique KineQuick (`https://www.q-top.be/online-planner-v2/`), un wizard multi-étapes
(lieu → spécialité → durée → thérapeute → date) sans lien visuel avec la charte Kinovea.

Objectif : construire une interface de prise de RDV maison, à l'image de kinovea.be, qui écrit
réellement dans le même agenda KineQuick — sans rien changer côté backend KineQuick — pour ensuite
la pitcher à KineQuick comme piste de produit. L'attribution "Powered by KineQuick" est conservée.

## Reconnaissance technique (déjà effectuée)

- Le widget KineQuick charge d'abord `GET request.handler.php?function=getAuthData&root=kq43414`
  sur `www.q-top.be`, qui renvoie des identifiants (chiffrés) pour un compte `webuser` scoped au
  root, ainsi que l'URL de l'API réelle : `https://aws1.kqc.be`.
- Le front KineQuick (`js/functions.js`) se connecte ensuite via `synAuth` (lib côté client) et
  signe lui-même chaque requête (`SessionSign`) vers des endpoints REST du type
  `{url}/{root}/WebAgenda/{Function}` :
  - `WebAgenda/GetConfig` — locations, spécialités, thérapeutes, types de RDV, réglages
    (`minBookingHours`, `maxBookingDays`, `maxAppReqPerDay`, `maxAppReqPerSess`, etc.)
  - `WebAgenda/GetAvailabilities` — créneaux libres (POST avec `DateFrom`, `DateTo`,
    `OptionalLocationID`, `OptionalSpecialtyID`, `OptionalAppointmentTypeID`)
  - `WebAgenda/GetExistingPatient` — recherche patient par numéro NISS
  - `WebAgenda/AddAppointment` — création réelle du RDV
  - `WebAgenda/GetAppointmentDetails`, `WebAgenda/DeleteAppointment`
- **CORS vérifié** : `request.handler.php` répond avec
  `Access-Control-Allow-Origin: https://www.kinequick.be` quel que soit l'`Origin` envoyé — accès
  direct depuis `kinovea.be` (ou tout autre domaine tiers) impossible depuis le navigateur.
  → un relais côté serveur est obligatoire, ce n'est pas une option de confort.

## Périmètre

Tout le root `kq43414` : les 2 cabinets Kinovea (Lasne, Rhode-Saint-Genèse) **et** tous les groupes
"Domiciles ..." (visites à domicile par région). Un seul outil remplace entièrement le widget
KineQuick pour ce root.

## Architecture

Le tout vit dans le repo `kinovea/` existant (même projet Vercel, même déploiement statique + zéro
build), en deux parties :

```
kinovea/
├── api/
│   └── kq/
│       ├── config.js           → wrappe WebAgenda/GetConfig (+ cache court)
│       ├── availabilities.js   → wrappe WebAgenda/GetAvailabilities
│       ├── patient-lookup.js   → wrappe WebAgenda/GetExistingPatient
│       └── book.js             → wrappe WebAgenda/AddAppointment
└── rdv/
    ├── index.html
    ├── rdv.css
    └── rdv.js
```

- **Proxy serverless** (`api/kq/*.js`, fonctions Vercel Node) : seul point qui parle à KineQuick.
  Reproduit le handshake `getAuthData` → décryptage → `SessionSign` déjà présent dans
  `functions.js`/`lib.synAuth.min.js` (référence directe, pas de réimplémentation from scratch).
  Comme c'est un appel serveur-à-serveur, le CORS restrictif de KineQuick ne s'applique pas ici.
  Les identifiants ne transitent jamais côté client — contrairement au widget KineQuick original.
- **Front vanilla** (`rdv/`) : HTML/CSS/JS sans build, cohérent avec le reste du site. N'appelle
  que `/api/kq/*` (même origine → aucun souci CORS côté front). Reprend la charte Kinovea (palette
  `--paper/--teal/--gold`, polices Fraunces + Inter) déjà définie dans `lasne/index.html`.

## Parcours utilisateur

Remplace le wizard étape par étape par une page à filtres combinables :

1. Bascule **Au cabinet / À domicile** en haut de page.
   - Au cabinet → choix Lasne ou Rhode-Saint-Genèse.
   - À domicile → choix de la région (réutilise les groupes "Domiciles ..." de KineQuick).
2. Filtres secondaires, combinables et visibles en même temps (pas de nouvelle étape) :
   - Spécialité (chips, ~20 valeurs, recherche si besoin)
   - Thérapeute (chips avec photo, optionnel)
3. Vue calendrier semaine inline montrant les créneaux réels dispo (au lieu de la liste paginée
   actuelle), avec raccourci "premier RDV disponible".
4. Résumé de sélection persistant (sticky) + CTA de réservation.

## Formulaire patient + confirmation

- Recherche patient existant par NISS → auto-remplissage si trouvé (`GetExistingPatient`).
- Sinon formulaire nouveau patient (mêmes champs obligatoires que le widget actuel).
- Soumission → `/api/kq/book` → `WebAgenda/AddAppointment` réel → écran de confirmation.
- Le RDV créé apparaît dans le même agenda KineQuick que le cabinet utilise déjà — rien ne change
  côté back-office.

## Fiabilité / erreurs

- Le proxy re-login automatiquement si la session KineQuick a expiré (même logique que
  `LogInAgain` dans le widget original).
- Si l'API KineQuick est indisponible ou lente, message de repli clair (numéro de téléphone / lien
  vers l'ancien widget) plutôt qu'une erreur muette.
- Un créneau réservé entre-temps par quelqu'un d'autre : l'échec de `AddAppointment` déclenche un
  re-fetch des disponibilités et un message clair, pas un plantage silencieux.

## Vérification

Pas de suite de tests lourde justifiée pour un POC vanilla + 4 fonctions serverless. La
vérification se fait en conditions réelles : exercer le parcours complet dans le navigateur de
prévisualisation, puis confirmer qu'un vrai RDV de test créé via la nouvelle UI apparaît dans le
back-office KineQuick.

## Risque connu

L'ensemble repose sur une API KineQuick non documentée (endpoints, format de signature). Un
changement côté KineQuick peut casser le proxy sans préavis. Acceptable pour une démo de pitch
faite avec l'accord implicite du fait que c'est notre propre compte/cabinet — mais à mentionner
explicitement à KineQuick dès que la démo est présentée, plutôt que de laisser tourner ça
silencieusement en prod par la suite.

## Hors périmètre (pour l'instant)

- Paiement en ligne / acompte.
- Gestion des annulations/modifications de RDV depuis la nouvelle UI (le widget KineQuick actuel
  reste disponible pour ça si besoin, via le lien "powered by").
- Migration vers React/Vite — restera vanilla tant que l'UI ne le justifie pas (cf. décision prise
  en amont).
