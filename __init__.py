"""
@author: rgthree
@title: Comfy Nodes
@nickname: rgthree
@description: A bunch of nodes I created that I also find useful.
"""

import glob
import inspect
import os
import shutil

# from .server import server

from .py.log import log_welcome
from .py.context import RgthreeContext
from .py.context_switch import RgthreeContextSwitch
from .py.context_switch_big import RgthreeContextSwitchBig
from .py.display_any import RgthreeDisplayAny, RgthreeDisplayInt
from .py.lora_stack import RgthreeLoraLoaderStack
from .py.seed import RgthreeSeed
from .py.sdxl_empty_latent_image import RgthreeSDXLEmptyLatentImage
from .py.power_prompt import RgthreePowerPrompt
from .py.power_prompt_simple import RgthreePowerPromptSimple
from .py.image_inset_crop import RgthreeImageInsetCrop
from .py.context_big import RgthreeBigContext
from .py.ksampler_config import RgthreeKSamplerConfig
from .py.sdxl_power_prompt_postive import RgthreeSDXLPowerPromptPositive
from .py.sdxl_power_prompt_simple import RgthreeSDXLPowerPromptSimple

NODE_CLASS_MAPPINGS = {
  RgthreeBigContext.NAME: RgthreeBigContext,
  RgthreeContext.NAME: RgthreeContext,
  RgthreeContextSwitch.NAME: RgthreeContextSwitch,
  RgthreeContextSwitchBig.NAME: RgthreeContextSwitchBig,
  RgthreeDisplayInt.NAME: RgthreeDisplayInt,
  RgthreeDisplayAny.NAME: RgthreeDisplayAny,
  RgthreeLoraLoaderStack.NAME: RgthreeLoraLoaderStack,
  RgthreeSeed.NAME: RgthreeSeed,
  RgthreeImageInsetCrop.NAME: RgthreeImageInsetCrop,
  RgthreePowerPrompt.NAME: RgthreePowerPrompt,
  RgthreePowerPromptSimple.NAME: RgthreePowerPromptSimple,
  RgthreeKSamplerConfig.NAME: RgthreeKSamplerConfig,
  RgthreeSDXLEmptyLatentImage.NAME: RgthreeSDXLEmptyLatentImage,
  RgthreeSDXLPowerPromptPositive.NAME: RgthreeSDXLPowerPromptPositive,
  RgthreeSDXLPowerPromptSimple.NAME: RgthreeSDXLPowerPromptSimple,
}


# This doesn't import correctly..
# WEB_DIRECTORY = "./web"

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
DIR_DEV_WEB = os.path.abspath(f'{THIS_DIR}/web/')
DIR_PY = os.path.abspath(f'{THIS_DIR}/py')

# remove old directory.
OLD_DIR_WEB = os.path.abspath(f'{THIS_DIR}/../../web/extensions/rgthree')
if os.path.exists(OLD_DIR_WEB):
  shutil.rmtree(OLD_DIR_WEB)

DIR_WEB = os.path.abspath(f'{THIS_DIR}/../../web/extensions/rgthree-comfy')
if os.path.exists(DIR_WEB):
  shutil.rmtree(DIR_WEB)
os.makedirs(DIR_WEB)

shutil.copytree(DIR_DEV_WEB, DIR_WEB, dirs_exist_ok=True)

NOT_NODES = ['constants', 'log', 'utils', 'rgthree']

__all__ = ['NODE_CLASS_MAPPINGS']

nodes = []
for file in glob.glob('*.py', root_dir=DIR_PY) + glob.glob('*.js', root_dir=os.path.join(DIR_DEV_WEB, 'js')):
  name = os.path.splitext(file)[0]
  if name not in nodes and name not in NOT_NODES and not name.startswith(
      '_') and not name.startswith('base') and not 'utils' in name:
    nodes.append(name)

log_welcome(num_nodes=len(nodes))
