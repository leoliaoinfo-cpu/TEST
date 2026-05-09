"""Configure matplotlib for CJK fonts once at import time."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

# Register any Noto CJK fonts present on the system (Docker installs fonts-noto-cjk)
for _fp in font_manager.findSystemFonts(fontext="ttf"):
    if "Noto" in _fp and ("CJK" in _fp or "cjk" in _fp):
        try:
            font_manager.fontManager.addfont(_fp)
        except Exception:
            pass

matplotlib.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Noto Sans CJK TC", "Noto Sans CJK SC", "DejaVu Sans", "sans-serif"],
    "axes.unicode_minus": False,
})
