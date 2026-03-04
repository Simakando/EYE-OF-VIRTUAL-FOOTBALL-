# VF Signal Predictor v7.2 🎯

**BetPawa Zambia Virtual Football Prediction Tool**

Advanced prediction engine with signal detection, 12-point under-filter system, and advanced statistical validation gate.

## 🚀 Features

- **Signal Detection Engine**: Scans Kiron VFL API for historical patterns
- **Persistent Storage**: Signals saved in IndexedDB (survives restarts)
- **12-Point Under-Filter System**: Removes likely under matches
- **Advanced Stats Gate**: 16 statistical metrics validation (NEW v7.2)
- **Auto-Pruning**: Removes underperforming signals automatically
- **Top Performer Tracking**: Highlights signals with ≥70% hit rate
- **Self-Learning ML**: Adjusts thresholds based on results

## 📦 Deployment Options

### Option 1: GitHub Pages (Recommended)

1. **Create a new GitHub repository**
2. **Upload these files**:
   - `index.html` (the main HTML file)
   - `vf-predictor-v7.2-engine.js` (the JavaScript engine)
3. **Enable GitHub Pages**:
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / `root`
   - Click Save
4. **Access your app**:
   - `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

### Option 2: Direct File Opening

1. Download both files to your computer
2. Make sure `vf-predictor-v7.2-engine.js` is in the same folder as `index.html`
3. Open `index.html` in your browser (Chrome/Firefox recommended)
4. The app will work but may have CORS restrictions

### Option 3: Local Server

```bash
# If you have Python installed:
python -m http.server 8000

# Or with Node.js:
npx serve

# Then open: http://localhost:8000
```

## 🔧 Connection Issues Troubleshooting

### If predictions aren't showing:

1. **Check the status bar** - should show "🟢 LIVE" with green dot
2. **Toggle the connection switch** - Turn OFF then ON
3. **Check browser console** (F12) for error messages
4. **Try manual refresh** - Click the "🔄 Refresh" button
5. **Clear browser cache** - Ctrl+Shift+Del → Clear cache

### Common Issues:

**"No matches found"**
- The virtual football round may not be active
- Try refreshing in 5-10 minutes
- Check if BetPawa Zambia site is accessible

**"CORS errors in console"**
- Normal when opening HTML file directly
- Use GitHub Pages or local server instead
- The proxies will handle CORS automatically

**"Signals not loading"**
- First run takes 30-60 seconds to scan historical data
- Look for progress bar under "VF Signal Engine Initializing..."
- Check "Signals" tab to see if patterns are detected

**"Everything shows 0"**
- IndexedDB may be disabled in browser
- Enable cookies/storage for the site
- Try incognito mode to test

### API Endpoints Used:

The app connects to:
- `https://betpawa-proxy-production.up.railway.app` (BetPawa API proxy)
- `https://api.kir0n.com` (Kiron VFL API)
- CORS proxies: `api.allorigins.win`, `corsproxy.io`

If any endpoint is down, the app will try alternatives.

## 📊 How It Works

### 3-Gate Prediction System

**Gate 1: Signal Detection**
- Scans historical VFL matches
- Only signals with ≥30 occurrences qualify
- Must have ≥50% over 3.5 hit rate
- Saves to IndexedDB for persistence

**Gate 2: 12-Point Under-Filter**
- Market Odds Check
- Dominant Favorite Detection
- Marginal Signal Rate
- Support-Only Signals
- H2H Low Goals History
- League Low Average
- Close Draw Odds
- Even Money Trap
- Scoreline Conflict
- Signal Conflict Count
- Confidence/Rate Mismatch
- Defensive Teams Check

**Gate 3: Advanced Stats (NEW v7.2)**
- Combined Attack Strength
- Defensive Vulnerability
- Over 3.5 Historical Rate
- Match Excitement Index (MEI)
- Under Trap Detection
- Low-Scoring Risk
- Elite Over Probability

### Signal Qualification

Pattern must have:
- ✅ Minimum 30 match occurrences
- ✅ Over 3.5 hit rate ≥ 50%
- ✅ Signal strength ≥ 40

**Top Performers** (🏆 Gold):
- Hit rate ≥ 70%
- Occurrences ≥ 50 matches

**Auto-Pruned** (🗑️):
- Hit rate drops below 40%
- After 50+ tracked results

## 🎯 Using the Predictor

### Live Tab
- Shows upcoming matches with predictions
- **Green cards**: Approved predictions
- **Gold cards**: Ultra-high confidence (90%+)
- **Purple cards**: Filtered out by under-filters
- **Orange tags**: Caution (proceed carefully)

### Results Tab
- Tracks prediction accuracy
- Rolling 20-result window
- Shows correct/wrong/pending
- Accuracy percentage

### Signals Tab
- View all qualified signals
- Filter by type, performance
- Search by description
- See top performers highlighted

### ML Tab
- View learning status
- See auto-adjusted thresholds
- Download ML data (JSON)
- Clear ML data

### Guide Tab
- Complete system documentation
- Filter explanations
- Signal qualification rules
- Strategy tips

## 🔐 Privacy & Data

- All data stored locally in browser (IndexedDB)
- No data sent to external servers
- Signal patterns persist across sessions
- Use "🔄 RESET" button to clear everything

## ⚙️ Advanced Configuration

Edit `vf-predictor-v7.2-engine.js` to customize:

```javascript
// Line ~20 - Thresholds
let T = {
  minSignalRate: 50,           // Minimum signal hit rate
  minStrength: 40,             // Minimum signal strength
  over35TriggerRate: 65,       // When to suggest Over 3.5
  underFilterSensitivity: 2,   // Filters to block (default 3+)
  minAttackStrength: 1.0,      // Advanced: min attack
  minMEI: 50,                  // Advanced: min excitement index
  // ... more options
};

// Line ~51 - Constants
const MIN_SIGNAL_OCC = 30;           // Min matches to qualify
const TOP_PERFORMER_RATE = 70;       // Top performer threshold
const MATCHDAYS_AHEAD = 2;           // How far ahead to predict
```

## 🆘 Support

### Browser Compatibility
- ✅ Chrome/Chromium (Recommended)
- ✅ Firefox
- ✅ Edge
- ✅ Safari (may have IndexedDB limits)
- ❌ Internet Explorer (not supported)

### Mobile
- Works on mobile browsers
- Best experience on tablet/desktop
- Enable desktop mode for full features

### Performance
- First load: 30-60 seconds (scanning historical data)
- Subsequent loads: Instant (loads from IndexedDB)
- Auto-refresh: Every 5 minutes
- Memory usage: ~50-100MB

## 📝 File Structure

```
project/
├── index.html (or vf-predictor-v7.2-complete.html)
└── vf-predictor-v7.2-engine.js
```

That's it! Just 2 files needed.

## 🔄 Updates

**v7.2 (Current)**
- Advanced Statistical Filter Gate (16 metrics)
- Match Excitement Index (MEI)
- Elite Over Probability calculation
- Under Trap Detection
- Attack/Defense strength analysis
- MD+2 prediction mode

**v7.1**
- Signal persistence (IndexedDB)
- Auto-pruning underperformers
- Top performer highlighting

**v7.0**
- 12-Point Under-Filter System
- Self-learning ML engine

## ⚖️ Disclaimer

This tool is for entertainment and educational purposes only. Predictions are based on historical patterns and statistical analysis. **Gambling involves risk.** Never bet more than you can afford to lose. Please gamble responsibly.

## 📜 License

Free to use and modify for personal use.

---

**Made for BetPawa Zambia Virtual Football** 🇿🇲⚽
