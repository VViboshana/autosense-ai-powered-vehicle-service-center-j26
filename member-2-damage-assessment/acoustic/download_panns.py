"""Run once: downloads the PANNs CNN14 weights (~330 MB) and AudioSet label list into ~/panns_data.

panns_inference would fetch them itself with `wget`, which Windows does not have.
"""
import urllib.request
from pathlib import Path

FILES = {
    'class_labels_indices.csv': 'http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv',
    'Cnn14_mAP=0.431.pth': 'https://zenodo.org/record/3987831/files/Cnn14_mAP%3D0.431.pth?download=1',
}

folder = Path.home() / 'panns_data'
folder.mkdir(exist_ok=True)
for name, url in FILES.items():
    path = folder / name
    if not path.exists() or path.stat().st_size < 1000:
        print(f'Downloading {name} ...')
        urllib.request.urlretrieve(url, path)
    print(f'{path} ({path.stat().st_size / 1e6:.1f} MB)')
