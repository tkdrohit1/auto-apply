# Minimal config.py for decoupled local Desktop Agent
import os
from pathlib import Path

_settings = {}

def set_settings(settings_dict):
    global _settings
    _settings = settings_dict

def load_settings():
    return _settings
