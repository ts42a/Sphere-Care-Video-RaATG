# How to Access Sphere Care from Other Devices

Everything runs on **one PC** (the host). Other devices on the **same Wi-Fi network** can access it:

- **Another PC** → opens the **Staff Web Dashboard** in a browser
- **Mobile phone** → opens the **Client App** using Expo Go

---

## How It Works (Simple Overview)

```
 [Host PC]  ──── runs the backend server (port 8000)
    │              └── also serves the Staff Web Dashboard
    │
    │        ──── runs the Expo dev server (port 3000)
    │              └── serves the Client App
    │
    ├── Same Wi-Fi ──► [Other PC]   → opens Staff Web in browser
    │
    └── Same Wi-Fi ──► [Phone]      → opens Client App via Expo Go
```

---

## Step 1: Find the Host PC's IP Address

On the PC that runs the servers:

1. Open **PowerShell** or **Command Prompt**.
2. Run:

   ```
   ipconfig
   ```

3. Look for **Wireless LAN adapter Wi-Fi** (or Ethernet if wired).
4. Find **IPv4 Address** — it looks like:

   ```
   IPv4 Address. . . . . . . . . . . : 192.168.1.105
   ```

5. **Write this number down.** All other devices will use it.

> In the examples below, we use `192.168.1.105`. Replace it with your actual IP.

---

## Step 2: Staff Web Dashboard (Other PC)

The Staff Web is served directly by the backend on port `8000`. Since the backend runs on `0.0.0.0`, it already accepts connections from other devices.

**No extra setup needed.** Just open a browser on the other PC and go to:

```
http://192.168.1.105:8000
```

That's it. The staff login page will load. All API calls from the staff web use relative paths (`/api/v1/...`), so they automatically go to the same server — no config changes needed.

### What staff users can access:

| Page | URL |
| ---- | --- |
| Staff Dashboard | `http://192.168.1.105:8000` |
| API Docs (Swagger) | `http://192.168.1.105:8000/docs` |

---

## Step 3: Client App on Phone (Mobile)

The Client App is built with Expo (React Native). Mobile users access it through the **Expo Go** app.

### 3a. Set the API URL for the phone

By default, the client app talks to `http://localhost:8000`, which won't work from a phone. Fix this by creating a `.env` file in the `frontend_client` folder:

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.105:8000
```

> **Important:** Restart the Expo server after creating or changing this file.

### 3b. Install Expo Go on the phone

- **Android:** [Expo Go on Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)
- **iOS:** [Expo Go on App Store](https://apps.apple.com/app/expo-go/id982107779)

### 3c. Start the Expo server on the host PC

Open a terminal in the `frontend_client` folder and run:

```
npx expo start --tunnel
```

A **QR code** will appear in the terminal.

### 3d. Scan the QR code

- **Android:** Open Expo Go app → Scan QR code
- **iOS:** Open the Camera app → Point at QR code → Tap the link

The Client App will open on your phone.

### Alternative: LAN mode (faster, same Wi-Fi only)

```
npx expo start --lan
```

Same steps — scan the QR code. This is faster but both devices must be on the same network.

---

## Step 4: Windows Firewall (If Other Devices Can't Connect)

If other devices **cannot reach** the host PC, Windows Firewall may be blocking the ports.

1. Open **Start Menu** → search **Windows Defender Firewall**.
2. Click **Advanced Settings** on the left.
3. Click **Inbound Rules** → **New Rule** on the right.
4. Choose **Port** → click **Next**.
5. Choose **TCP** → type `8000, 3000` → click **Next**.
6. Choose **Allow the connection** → click **Next**.
7. Check all boxes (Domain, Private, Public) → click **Next**.
8. Name it `Sphere Care Servers` → click **Finish**.

---

## Quick Reference

| Device | What They Access | URL / Method |
| ------ | --------------- | ------------ |
| **Other PC** | Staff Web Dashboard | `http://<HOST-IP>:8000` in browser |
| **Other PC** | API Docs | `http://<HOST-IP>:8000/docs` in browser |
| **Phone** | Client App (Mobile) | Scan QR code from `npx expo start --tunnel` |
| **Phone** | Client App (Web) | `http://<HOST-IP>:3000` in phone browser |

---

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Other PC can't open Staff Web | Check they are on the **same Wi-Fi**. Try the firewall fix (Step 4). |
| Phone can't load Client App | Make sure `.env` has the host PC's IP, not `localhost`. Restart Expo. |
| Staff Web loads but API calls fail | This shouldn't happen (relative paths). Clear browser cache and retry. |
| QR code doesn't work | Try `--tunnel` instead of `--lan`, or vice versa. |
| IP address changed | Run `ipconfig` again. Update the `.env` file. Tell the other PC the new IP. |
| "Network request failed" on phone | Backend not running, or firewall blocking port 8000. |
