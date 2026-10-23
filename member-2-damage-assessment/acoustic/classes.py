"""The sound classes, the situation each one belongs to, and how each source dataset's labels map to them."""

# The technician picks the situation before recording; the model then only chooses between that situation's classes.
SITUATIONS = {
    'starting': ['normal_start', 'bad_ignition', 'dead_battery'],
    'idling': ['normal_idle', 'low_oil', 'power_steering', 'serpentine_belt', 'misfire', 'tappet'],
    'braking': ['normal_brakes', 'worn_brakes'],
}
CLASSES = [c for classes in SITUATIONS.values() for c in classes]
SITUATION_OF = {c: s for s, classes in SITUATIONS.items() for c in classes}
NORMAL = {'normal_start', 'normal_idle', 'normal_brakes'}

# Source label -> our class. Labels not listed are not used (e.g. "air leak", which no other dataset has).
CAR_DIAGNOSTICS = {  # Kaggle malakragaie/car-diagnostics-dataset: the folder name is the label
    'normal_engine_startup': 'normal_start',
    'bad_ignition': 'bad_ignition',
    'dead_battery': 'dead_battery',
    'normal_engine_idle': 'normal_idle',
    'low_oil': 'low_oil',
    'power_steering': 'power_steering',
    'serpentine_belt': 'serpentine_belt',
    'normal_brakes': 'normal_brakes',
    'worn_out_brakes': 'worn_brakes',
}
SRI_LANKA = {  # Hugging Face RashmiKarunarathne/MyDataSet: the file name without its number is the label
    'healthy': 'normal_idle',
    'misfire': 'misfire',
    'tappet_issue': 'tappet',
    'belt_issue': 'serpentine_belt',
}
AI_MECHANIC = {  # Kaggle eoinedge/ai-mechanic (Edge Impulse export): the text before the first dot is the label
    'idling': 'normal_idle',
    'normal engine inside cabin': 'normal_idle',
}
