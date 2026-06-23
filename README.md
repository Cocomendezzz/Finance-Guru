# Financial Guide — PWA

Monthly financial tracker for an NYC S-corp. Runs as a home screen app on iPhone/Android.

---

## Deploy (same flow as the workout tracker)

### 1. Create a GitHub repo

```bash
cd financial-guide
git init
git add .
git commit -m "init"
gh repo create financial-guide --private --push --source=.
```

Or push manually via github.com → New Repository → push existing.

### 2. Deploy to Vercel

Go to [vercel.com](https://vercel.com) → Add New Project → Import the `financial-guide` repo.

Settings will auto-detect Vite. No changes needed. Deploy.

### 3. Add to your iPhone home screen

1. Open your Vercel URL in Safari (must be Safari for iOS PWA)
2. Tap the Share button (box with arrow)
3. Scroll down → **Add to Home Screen**
4. Name it "Finance" → Add

Opens full-screen, no browser chrome — same as the workout tracker.

---

## Local dev

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

---

## What's in it

| Section | What it does |
|---------|-------------|
| Overview | Income allocator — enter any payment, see the split |
| Budget | Editable expense calculator, minimum gross income needed |
| Fund | 9-month emergency fund target + progress tracker |
| Taxes | SE tax estimator, quarterly dates, deductions list, the 24-hour transfer system |
| Invest | Compound growth calculator, Roth/SEP-IRA priority, three-fund portfolio |

All inputs are saved to localStorage — your numbers persist between sessions.

---

## Notes

- iOS PWA requires Safari to install. Chrome on iPhone can't add to home screen.
- The tax estimator is a rough guide. Deductions will lower your actual bill. CPA strongly recommended.
- Rates (HYSA, contribution limits) are based on 2024 figures. Check before acting.
