from PIL import Image, ImageDraw
from pathlib import Path

out = Path('/Users/stepanzadola/.openclaw/workspace/tv-electron-mvp/assets')
out.mkdir(parents=True, exist_ok=True)
img = Image.new('RGBA', (1024, 1024), '#0b1020')
d = ImageDraw.Draw(img)
d.rounded_rectangle((96, 96, 928, 928), radius=180, fill='#17203a', outline='#71a7ff', width=24)
d.rounded_rectangle((210, 260, 814, 700), radius=42, fill='#0f1528')
d.rectangle((330, 760, 694, 800), fill='#71a7ff')
d.polygon([(450, 430), (450, 530), (610, 480)], fill='#71a7ff')
img.save(out / 'icon-1024.png')
print(out / 'icon-1024.png')
