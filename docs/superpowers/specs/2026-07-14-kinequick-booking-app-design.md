# Kinovea — Prise de rendez-vous (powered by KineQuick)

## Contexte

Le cabinet Kinovea (Lasne, Rhode-Saint-Genèse, + visites à domicile par région) utilise KineQuick
comme backend de gestion d'agenda (`root=kq43414`). La prise de RDV en ligne actuelle se fait via
le widget générique KineQuick (`https://www.q-top.be/online-planner-v2/`), un wizard multi-étapes
(lieu → spécialité → durée → thérapeute → date) sans lien visuel avec la charte Kinovea.

Objectif : construire une interface de prise de RDV maison, à l'image de kinovea.be, qui écrit
réellement dans le même agenda KineQuick — sans rien changer côté backend KineQuick — pour ensuite
la pitcher à KineQuick comme piste de produit. L'attribution "Powered by KineQuick" est conservée.

**Statut : environnement de dev / démo de pitch, pas un remplacement en prod du jour au lendemain.**
Le produit est construit pour couvrir tout le root fonctionnellement (sinon la démo n'est pas
convaincante), mais il n'est pas poussé comme parcours de réservation par défaut pour les vrais
patients tant qu'il n'a pas été montré à KineQuick — voir "Risque connu". Le lien vers le widget
KineQuick existant reste donc actif et trouvable pendant toute cette phase.

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
  - `WebAgenda/AddAppointment` — création réelle du RDV. **Contrat vérifié dans `getFormAppData()`
    (functions.js:5601) — pas d'endpoint séparé pour créer un patient**, tout part en un seul
    POST :
    ```json
    {
      "patientDetails": {
        "Language": "", "Title": "", "FirstName": "", "FamilyName": "", "BirthDate": "",
        "StreetNbr": "", "ZIP": "", "City": "", "EMail": "", "Telephone": ""
      },
      "patientID": 0,
      "patientBirthdate": "",
      "appointmentRemark": "",
      "therapistID": 0, "specialtyID": 0, "appointmentTypedID": 0,
      "appointmentStart": "dd/mm/yyyy hh:mm",
      "locationID": 0
    }
    ```
    Patient existant → `patientID` renseigné (issu de `GetExistingPatient`) et `patientDetails`
    peut rester minimal. Nouveau patient → `patientID: 0` et `patientDetails` complet. `book.js`
    n'a donc qu'un seul appel à faire, pas deux.
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
│       ├── _lib/
│       │   └── kqAuth.js        → handshake getAuthData → décryptage → SessionSign, partagé
│       ├── config.js            → wrappe WebAgenda/GetConfig (+ cache court)
│       ├── availabilities.js    → wrappe WebAgenda/GetAvailabilities
│       ├── patient-lookup.js    → wrappe WebAgenda/GetExistingPatient
│       └── book.js              → wrappe WebAgenda/AddAppointment
└── rdv/
    ├── index.html
    ├── rdv.css
    └── rdv.js
```

- **Proxy serverless** (`api/kq/*.js`, fonctions Vercel Node) : seul point qui parle à KineQuick.
  Les 4 handlers importent tous `_lib/kqAuth.js`, qui reproduit le handshake `getAuthData` →
  décryptage → `SessionSign` déjà présent dans `functions.js`/`lib.synAuth.min.js` (référence
  directe, pas de réimplémentation from scratch) — logique écrite une seule fois, pas dupliquée
  par endpoint. Comme c'est un appel serveur-à-serveur, le CORS restrictif de KineQuick ne
  s'applique pas ici. Les identifiants ne transitent jamais côté client — contrairement au widget
  KineQuick original.
- **Session côté proxy** : les fonctions Vercel sont sans état entre invocations froides, donc
  `kqAuth.js` garde le token de session signé dans une variable de module (réutilisée tant que
  l'instance reste chaude) et revalide contre `maxSessLifeTime` (5 min, valeur reprise du widget
  original) avant chaque appel — s'il a expiré ou que l'instance est froide, le handshake complet
  est refait. C'est le choix le plus simple qui marche pour un POC ; si la latence du handshake
  répété devient un problème visible, la même interface peut être adossée à un cache partagé
  (Vercel KV / Edge Config) sans changer l'API des 4 endpoints.
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
- Gestion des annulations/modifications de RDV depuis la nouvelle UI : le widget KineQuick actuel
  reste accessible pour ça — un lien texte, pas ré-embarqué dans la nouvelle page — via le badge
  "Powered by KineQuick".
- Migration vers React/Vite — restera vanilla tant que l'UI ne le justifie pas (cf. décision prise
  en amont).
