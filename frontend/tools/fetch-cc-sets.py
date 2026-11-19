# The songs for tools/map-human.mjs (the mapper against human charts): Creative Commons music
# (licences checked on the artists' own pages, Nov 19 2026: incompetech.com, scottbuckley.com.au,
# Eric Skiff's Resistor Anthems) with human-made osu!mania 4K charts. Downloads each set (.osz) from
# the osu! mirror the app's fan charts use and keeps only the 4K mania charts and the audio file
# they name, in <out>/<id>/. Data only: nothing in them is run. Keep <out> outside the repo (the
# audio is never committed); credits are in NOTICE.md.
#
#   python -I tools/fetch-cc-sets.py <out folder>
import io, json, os, re, sys, time, urllib.request, zipfile

out = sys.argv[1]
SETS = {
    510470: ('Kevin MacLeod', 'Fife and Drum', 'CC BY 4.0'),
    608653: ('Kevin MacLeod', 'March of the Spoons', 'CC BY 4.0'),
    882519: ('Kevin MacLeod', 'The Show Must Be Go', 'CC BY 4.0'),
    1452286: ('Kevin MacLeod', 'Meatball Parade', 'CC BY 4.0'),
    1604756: ('Kevin MacLeod', 'Spazzmatica Polka', 'CC BY 4.0'),
    1743483: ('Kevin MacLeod', 'Scheming Weasel (faster)', 'CC BY 4.0'),
    2136894: ('Kevin MacLeod', 'If I Had a Chicken', 'CC BY 4.0'),
    2295883: ('Kevin MacLeod', 'Stringed Disco', 'CC BY 4.0'),
    2181567: ('Kevin MacLeod', 'Griphop', 'CC BY 4.0'),
    2434857: ('Kevin MacLeod', 'Local Forecast - Elevator', 'CC BY 4.0'),
    1301040: ('Kevin MacLeod', 'Le Grand Chase', 'CC BY 4.0'),
    2274064: ('Kevin MacLeod', 'Gold Rush', 'CC BY 4.0'),
    2651367: ('Kevin MacLeod', 'Big Rock', 'CC BY 4.0'),
    2523137: ('Kevin MacLeod', 'Bittersweet', 'CC BY 4.0'),
    2349874: ('Scott Buckley', 'Extrapolation', 'CC BY 4.0'),
    2367503: ('Scott Buckley', 'September 21', 'CC BY 4.0'),
    2351220: ('Scott Buckley', 'Three Sheets To The Wind', 'CC BY 4.0'),
    2367936: ('Scott Buckley', 'Time and Space', 'CC BY 4.0'),
    1836415: ('Eric Skiff', 'Arpanauts', 'CC BY 3.0'),
}
UA = 'rythm-architect-mapper-benchmark/1.0'
AUDIO = re.compile(r'\.(mp3|ogg|wav)$', re.I)
index = []
for sid, (artist, title, lic) in SETS.items():
    dest = os.path.join(out, str(sid))
    if os.path.exists(os.path.join(dest, 'set.json')):
        index.append(json.load(open(os.path.join(dest, 'set.json'), encoding='utf-8')))
        continue
    try:
        req = urllib.request.Request(f'https://catboy.best/d/{sid}', headers={'User-Agent': UA})
        data = urllib.request.urlopen(req, timeout=120).read()
        z = zipfile.ZipFile(io.BytesIO(data))
    except Exception as e:
        print(sid, title, 'failed:', e)
        continue
    charts, audio = [], None
    for name in z.namelist():
        base = os.path.basename(name)
        if not base.lower().endswith('.osu'):
            continue
        text = z.read(name).decode('utf-8', 'replace')
        mode = re.search(r'^Mode:\s*(\d+)', text, re.M)
        cs = re.search(r'^CircleSize:\s*([\d.]+)', text, re.M)
        if not (mode and mode.group(1) == '3' and cs and round(float(cs.group(1))) == 4):
            continue
        a = re.search(r'^AudioFilename:\s*(.+?)\s*$', text, re.M)
        ver = re.search(r'^Version:\s*(.+?)\s*$', text, re.M)
        charts.append({'version': ver.group(1) if ver else base, 'text': text, 'audio': a.group(1) if a else None})
    if not charts:
        print(sid, title, 'no 4K chart in the set')
        continue
    want = charts[0]['audio']
    names = {os.path.basename(n).lower(): n for n in z.namelist()}
    src = names.get((want or '').lower())
    if not src or not AUDIO.search(src):
        print(sid, title, 'audio not found:', want)
        continue
    os.makedirs(dest, exist_ok=True)
    ext = os.path.splitext(src)[1].lower()
    open(os.path.join(dest, 'audio' + ext), 'wb').write(z.read(src))
    for i, c in enumerate(charts):
        open(os.path.join(dest, f'chart{i}.osu'), 'w', encoding='utf-8').write(c['text'])
    meta = {'id': sid, 'artist': artist, 'title': title, 'license': lic, 'audio': 'audio' + ext, 'charts': [{'file': f'chart{i}.osu', 'version': c['version']} for i, c in enumerate(charts)]}
    json.dump(meta, open(os.path.join(dest, 'set.json'), 'w', encoding='utf-8'))
    index.append(meta)
    print(sid, title, f'{len(charts)} chart(s), audio {ext}, {len(data) // 1024} KB')
    time.sleep(1.5)
json.dump(index, open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'), indent=1)
print('sets kept:', len(index))
