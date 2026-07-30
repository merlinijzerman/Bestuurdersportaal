#!/usr/bin/env python3
"""
promo/maak-muziek.py — genereert een rustige bedtrack, rechtenvrij.

    python3 promo/maak-muziek.py --stijl rust --duur 45
    python3 promo/maak-muziek.py --stijl warm --duur 45
    python3 promo/maak-muziek.py --stijl piano --duur 45
    python3 promo/maak-muziek.py --alles --duur 45     → alle drie

Waarom dit script het oude maak-muziek.sh vervangt:
de vorige versie stapelde kale sinustonen met ffmpeg. Een kale sinus heeft geen
boventonen en klinkt daardoor als een testtoon, niet als een instrument — en
juist dát is wat op den duur irriteert. Hier bouwen we elke toon op uit een
grondtoon plus boventonen met een eigen envelope, met lichte detune tussen de
stemmen. Dat is het verschil tussen "pieptoon" en "klank".

Drie stijlen, bewust verschillend van karakter:

  rust   Alleen een akkoordenbed. Geen melodie, geen ritme, niets dat om
         aandacht vraagt. Het minst opdringerig — en het veiligst als de video
         vaak achter elkaar bekeken wordt.
  warm   Lager en donkerder, tragere akkoordwisselingen, meer boventonen in de
         lage regionen. Voelt "bestuurlijker", minder licht.
  piano  Spaarzame, uitdempende aanslagen boven een zacht bed. Meer menselijk
         van karakter, maar ook meer aanwezig.

Uitvoer: promo/muziek-<stijl>.mp3 (piek -3 dBFS; montage.sh zet hem daarna op
bedniveau, standaard -26 dBFS).
"""

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
HIER = Path(__file__).resolve().parent


# ── Klankopbouw ─────────────────────────────────────────────────────────────

def toon(freq: float, duur: float, boventonen, detune_cent: float = 0.0) -> np.ndarray:
    """
    Eén stem: grondtoon + boventonen.

    `boventonen` is een lijst amplitudes voor harmonische 1, 2, 3, ... Een
    natuurlijk klinkende klank heeft snel aflopende boventonen; te veel hoge
    harmonischen maken het schel, precies wat we niet willen.
    """
    n = int(duur * SR)
    t = np.arange(n) / SR
    f = freq * (2 ** (detune_cent / 1200.0))
    uit = np.zeros(n, dtype=np.float64)
    for i, amp in enumerate(boventonen, start=1):
        if amp <= 0:
            continue
        # Lichte faseverschuiving per harmonische voorkomt dat alle componenten
        # op t=0 optellen tot één harde piek.
        uit += amp * np.sin(2 * np.pi * f * i * t + i * 0.7)
    return uit


def envelope(n: int, aanslag: float, verval: float, sustain: float, los: float) -> np.ndarray:
    """Klassieke ADSR, in seconden. Voorkomt klikken aan begin en eind."""
    a = max(1, int(aanslag * SR))
    d = max(1, int(verval * SR))
    r = max(1, int(los * SR))
    s = max(1, n - a - d - r)
    env = np.concatenate([
        np.linspace(0.0, 1.0, a),
        np.linspace(1.0, sustain, d),
        np.full(s, sustain),
        np.linspace(sustain, 0.0, r),
    ])
    if len(env) < n:
        env = np.pad(env, (0, n - len(env)), constant_values=0.0)
    return env[:n]


def akkoord(frequenties, duur: float, boventonen, stemamp=None) -> np.ndarray:
    """Meerdere stemmen samen, elk licht ontstemd zodat het niet steriel klinkt."""
    n = int(duur * SR)
    uit = np.zeros(n, dtype=np.float64)
    for i, f in enumerate(frequenties):
        amp = 1.0 if stemamp is None else stemamp[i]
        # Twee stemmen per noot, een paar cent uit elkaar: dat geeft een trage
        # zweving en daarmee "breedte" zonder chorus-effect.
        uit += amp * toon(f, duur, boventonen, detune_cent=-3.5)
        uit += amp * toon(f, duur, boventonen, detune_cent=+3.5)
    return uit / max(1, len(frequenties) * 2)


def leg_over(basis: np.ndarray, stuk: np.ndarray, start: int) -> None:
    """Mengt `stuk` in `basis` vanaf sample `start` (in-place, met bounds-check)."""
    eind = min(len(basis), start + len(stuk))
    if eind <= start:
        return
    basis[start:eind] += stuk[: eind - start]


# ── Stijlen ─────────────────────────────────────────────────────────────────

# Am – F – C – G – Em – Dm, in een lage ligging.
AKKOORDEN_HOOG = [
    [220.00, 261.63, 329.63],   # Am
    [174.61, 220.00, 261.63],   # F
    [196.00, 261.63, 329.63],   # C
    [196.00, 246.94, 293.66],   # G
    [164.81, 246.94, 329.63],   # Em
    [146.83, 220.00, 293.66],   # Dm
]
AKKOORDEN_LAAG = [[f / 2 for f in a] for a in AKKOORDEN_HOOG]


def bed(duur: float, akkoorden, akkoordduur: float, boventonen, overlap: float) -> np.ndarray:
    """Akkoorden die in elkaar overvloeien, doorlopend tot `duur`."""
    n = int(duur * SR)
    uit = np.zeros(n, dtype=np.float64)
    stap = akkoordduur - overlap
    i = 0
    t = -overlap / 2
    while t < duur:
        stuk = akkoord(akkoorden[i % len(akkoorden)], akkoordduur, boventonen)
        stuk *= envelope(len(stuk), overlap, 0.3, 0.92, overlap)
        leg_over(uit, stuk, int(max(0, t) * SR))
        t += stap
        i += 1
    return uit


def stijl_rust(duur: float) -> np.ndarray:
    """Alleen een bed. Zachte boventonen, trage wisselingen, geen melodie."""
    return bed(duur, AKKOORDEN_HOOG, akkoordduur=11.0,
               boventonen=[1.0, 0.28, 0.10, 0.04], overlap=5.0)


def stijl_warm(duur: float) -> np.ndarray:
    """Een octaaf lager, langer aangehouden, iets meer body in de lage tonen."""
    laag = bed(duur, AKKOORDEN_LAAG, akkoordduur=15.0,
               boventonen=[1.0, 0.42, 0.16, 0.07, 0.03], overlap=7.0)
    # Een heel zachte hoge laag houdt het open in plaats van dof.
    hoog = bed(duur, AKKOORDEN_HOOG, akkoordduur=15.0,
               boventonen=[1.0, 0.18, 0.05], overlap=7.0)
    return laag + 0.22 * hoog


def stijl_piano(duur: float) -> np.ndarray:
    """Spaarzame uitdempende aanslagen boven een zacht bed."""
    grond = 0.55 * bed(duur, AKKOORDEN_HOOG, akkoordduur=13.0,
                       boventonen=[1.0, 0.22, 0.07], overlap=6.0)
    n = len(grond)
    # Noten uit dezelfde toonsoort, ruim uit elkaar. Bewust onregelmatig
    # verdeeld: een strak raster gaat als een metronoom klinken.
    noten = [523.25, 392.00, 659.25, 440.00, 587.33, 349.23, 493.88, 440.00]
    tussen = [3.4, 4.1, 3.7, 4.6, 3.9, 4.3, 3.6, 4.4]
    t = 1.5
    k = 0
    while t < duur - 1.0:
        f = noten[k % len(noten)]
        lengte = 3.2
        stem = toon(f, lengte, [1.0, 0.30, 0.12, 0.05])
        # Pianoachtig: snelle aanslag, lang exponentieel verval.
        env = np.exp(-np.linspace(0, 5.2, len(stem)))
        env[: int(0.008 * SR)] *= np.linspace(0, 1, int(0.008 * SR))
        stem *= env * 0.30
        leg_over(grond, stem, int(t * SR))
        t += tussen[k % len(tussen)]
        k += 1
    return grond


STIJLEN = {"rust": stijl_rust, "warm": stijl_warm, "piano": stijl_piano}


# ── Afwerken ────────────────────────────────────────────────────────────────

def afwerken(sig: np.ndarray, duur: float) -> np.ndarray:
    """Banddoorlaat, in- en uitvloeier, en normaliseren op een vaste piek."""
    n = int(duur * SR)
    sig = sig[:n] if len(sig) >= n else np.pad(sig, (0, n - len(sig)))

    # Eenvoudige eerste-orde laagdoorlaat: haalt de scherpte van de hoge
    # boventonen zonder het geheel dof te maken.
    def laagdoorlaat(x, fc):
        a = np.exp(-2 * np.pi * fc / SR)
        uit = np.empty_like(x)
        vorig = 0.0
        for i in range(len(x)):
            vorig = (1 - a) * x[i] + a * vorig
            uit[i] = vorig
        return uit

    sig = laagdoorlaat(sig, 2600.0)
    # Hoogdoorlaat door het laagdoorlaatsignaal af te trekken: weg met rommel
    # onder ~35 Hz, die je toch niet hoort maar die wel headroom kost.
    sig = sig - laagdoorlaat(sig, 35.0)

    invloei = int(3.0 * SR)
    uitvloei = int(4.0 * SR)
    sig[:invloei] *= np.linspace(0, 1, invloei) ** 1.5
    sig[-uitvloei:] *= np.linspace(1, 0, uitvloei) ** 1.5

    piek = float(np.max(np.abs(sig))) or 1.0
    return sig * (10 ** (-3.0 / 20) / piek)


def schrijf(sig: np.ndarray, pad: Path) -> None:
    stereo = np.stack([sig, sig], axis=1)
    ruw = (np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes()
    ff = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
         "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0",
         "-c:a", "libmp3lame", "-q:a", "2", str(pad)],
        input=ruw, capture_output=True)
    if ff.returncode != 0:
        sys.exit(ff.stderr.decode()[:400])


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--stijl", choices=sorted(STIJLEN), default="rust")
    p.add_argument("--duur", type=float, default=45.0)
    p.add_argument("--alles", action="store_true")
    a = p.parse_args()

    for naam in (sorted(STIJLEN) if a.alles else [a.stijl]):
        print(f"› {naam} ({a.duur:.0f}s)")
        uit = HIER / f"muziek-{naam}.mp3"
        schrijf(afwerken(STIJLEN[naam](a.duur + 2.0), a.duur), uit)
        print(f"  → {uit}")

    print("\nMeemonteren:  PROMO_MUZIEK=promo/muziek-rust.mp3 bash promo/montage.sh")


if __name__ == "__main__":
    main()
