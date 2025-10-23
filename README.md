This is a [Next.js](https://nextjs.org) app for I‑Speak (Automated Speech Assessment).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

On first load, the app preloads the Whisper web model (tiny.en) with a splash screen:
- The splash shows a loading GIF, progress bar, and status.
- It hides early at 50% to let you explore the UI while the remaining download continues in the background.
- If you later switch the ASR model (e.g., base/base.en), that model will be downloaded when you run a transcription.

Note: First startup may take a little longer due to the one‑time model download.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load web fonts.

## Learn More

To learn more about Next.js, take a look at the following resources:


## API Endpoints (I‑Speak models)

Eight API routes are provided to run the converted models on the server. Each route accepts a JSON body with a `features` object. Your `public/model_js/*.js` files are loaded directly.

- POST /api/fluency
- POST /api/pronunciation
- POST /api/prosody
- POST /api/coherence
- POST /api/topic-relevance
- POST /api/complexity
- POST /api/accuracy
- POST /api/cefr

Body format:

```
{
	"features": {
		"Durasi (s)": 12.3,
		"MFCC (%)": 55.1,
		"Semantic Coherence (%)": 72.0,
		"Pause Freq": 0.18,
		"Token Count": 120,
		"Type Count": 80,
		"TTR": 0.66,
		"Pitch Range (Hz)": 110.5,
		"Articulation Rate": 3.4,
		"MLR": 5.2,
		"Mean Pitch": 180.0,
		"Stdev Pitch": 25.0,
		"Mean Energy": 0.12,
		"Stdev Energy": 0.03,
		"Num Prominences": 7,
		"Prominence Dist Mean": 0.45,
		"Prominence Dist Std": 0.11,
		"WPM": 120,
		"WPS": 2.0,
		"Total Words": 150,
		"Linking Count": 5,
		"Discourse Count": 2,
		"Filled Pauses": 3,
		"Topic Similarity (%)": 65.0,
		"Grammar Errors": 4,
		"Idioms Found": 1,
		"CEFR A1": 10,
		"CEFR A2": 8,
		"CEFR B1": 6,
		"CEFR B2": 4,
		"CEFR C1": 2,
		"CEFR C2": 0,
		"CEFR UNKNOWN": 3,
		"Bigram Count": 20,
		"Trigram Count": 10,
		"Fourgram Count": 5,
		"Synonym Variations": 12,
		"Avg Tree Depth": 2.1,
		"Max Tree Depth": 6
	}
}
```

Notes:
- Each subconstruct endpoint uses its own feature subset and order as defined in `lib/featureMapping.js`.
- The `/api/cefr` endpoint now uses 7 subconstruct scores as input (in this order):
	`[Fluency, Pronunciation, Prosody, Coherence and Cohesion, Topic Relevance, Complexity, Accuracy]`.
	It computes each subconstruct using its respective model server-side, takes the predicted score (argmax of class probabilities),
	and feeds those 7 numbers to the CEFR model. A StandardScaler is applied if provided (placeholder values are in `lib/modelLoader.js`).
- The JS model files in `public/model_js` must export either a function (default export) or an object with `score()`.

Feature parity and differences vs the original Python implementation are tracked here:
- See `FEATURE_PARITY.md` in this repo for an up-to-date comparison and implementation notes.

Example call (from browser or Node):

```js
await fetch("/api/fluency", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ features })
});
```

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

You can deploy this app to any Node-compatible host. For Vercel, follow Next.js deployment docs.
