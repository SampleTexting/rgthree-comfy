// / <reference path="../node_modules/litegraph.js/src/litegraph.d.ts" />
// @ts-ignore
import { app } from "../../scripts/app.js";
// @ts-ignore
import { rgthreeConfig } from "./rgthree_config.js";
import { rgthree } from "./rgthree.js";
import type {
  Vector2,
  LLink,
  LGraphCanvas as TLGraphCanvas,
  LGraph,
  SerializedLGraphNode,
  INodeInputSlot,
  INodeOutputSlot,
  LGraphNode as TLGraphNode,
  LiteGraph as TLiteGraph,
} from "./typings/litegraph.js";
import {
  IoDirection,
  LAYOUT_CLOCKWISE,
  LAYOUT_LABEL_OPPOSITES,
  LAYOUT_LABEL_TO_DATA,
  addConnectionLayoutSupport,
  addMenuItem,
  getSlotLinks,
  isValidConnection,
  setConnectionsLayout,
  waitForCanvas,
} from "./utils.js";
import { wait } from "./shared_utils.js";
import { RgthreeBaseNode } from "./base_node.js";

declare const LiteGraph: typeof TLiteGraph;
declare const LGraphNode: typeof TLGraphNode;
declare const LGraphCanvas: typeof TLGraphCanvas;

const CONFIG_REROUTE = rgthreeConfig?.["nodes"]?.["reroute"] || {};

const CONFIG_FAST_REROUTE = CONFIG_REROUTE["fast_reroute"];
const CONFIG_FAST_REROUTE_ENABLED = CONFIG_FAST_REROUTE["enabled"] ?? false;
const CONFIG_KEY_CREATE_WHILE_LINKING = CONFIG_FAST_REROUTE["key_create_while_dragging_link"];
const CONFIG_KEY_ROTATE = CONFIG_FAST_REROUTE["key_rotate"];
const CONFIG_KEY_RESIZE = CONFIG_FAST_REROUTE["key_resize"];
const CONFIG_KEY_MOVE = CONFIG_FAST_REROUTE["key_move"];
const CONFIG_KEY_CXN_INPUT = CONFIG_FAST_REROUTE["key_connections_input"];
const CONFIG_KEY_CXN_OUTPUT = CONFIG_FAST_REROUTE["key_connections_output"];

let configWidth = Math.max(
  Math.round((Number(CONFIG_REROUTE["default_width"]) || 40) / 10) * 10,
  10,
);
let configHeight = Math.max(
  Math.round((Number(CONFIG_REROUTE["default_height"]) || 30) / 10) * 10,
  10,
);
// Don't allow too small sizes. Granted, 400 is too small, but at least you can right click and
// resize... 10x10 you cannot.
while (configWidth * configHeight < 400) {
  configWidth += 10;
  configHeight += 10;
}
const configDefaultSize = [configWidth, configHeight] as Vector2;
const configResizable = !!CONFIG_REROUTE["default_resizable"];
let configLayout: [string, string] = CONFIG_REROUTE["default_layout"];
if (!Array.isArray(configLayout)) {
  configLayout = ["Left", "Right"];
}
if (!LAYOUT_LABEL_TO_DATA[configLayout[0]]) {
  configLayout[0] = "Left";
}
if (!LAYOUT_LABEL_TO_DATA[configLayout[1]] || configLayout[0] == configLayout[1]) {
  configLayout[1] = LAYOUT_LABEL_OPPOSITES[configLayout[0]]!;
}

type FastRerouteEntry = {
  node: RerouteNode;
  context: {
    connecting_node: TLGraphNode;
    connecting_input: INodeInputSlot | null;
    connecting_output: INodeOutputSlot | null;
    connecting_slot: number;
    connecting_pos: Vector2;
  };
};

/**
 * RerouteService handles any coordination between reroute nodes and the system. Mostly, it's for
 * fast-rerouting that can create a new reroute nodes while dragging a link.
 */
class RerouteService {
  private isFastLinking = false;
  private handledNewRerouteKeypress = false;
  private fastReroutesHistory: FastRerouteEntry[] = [];

  private handleLinkingKeydownBound = this.handleLinkingKeydown.bind(this);
  private handleLinkingKeyupBound = this.handleLinkingKeyup.bind(this);

  constructor() {
    if (CONFIG_FAST_REROUTE_ENABLED && CONFIG_KEY_CREATE_WHILE_LINKING?.trim()) {
      this.onCanvasSetUpListenerForLinking();
    }
  }

  /**
   * Waits for canvas to be available, then sets up a property accessor for `connecting_node` so
   * we can start/stop monitoring for ashortcute keys.
   */
  async onCanvasSetUpListenerForLinking() {
    const canvas = await waitForCanvas();
    canvas._connecting_node;

    const thisService = this;
    Object.defineProperty(canvas, "connecting_node", {
      get: function () {
        return this._connecting_node;
      },
      set: function (node) {
        const isStartingLinking = node != null && this._connecting_node == null;
        const isStoppingLinking = canvas._connecting_node != null && node == null;
        this._connecting_node = node;
        if (isStartingLinking) {
          thisService.startingLinking();
        }
        if (isStoppingLinking) {
          thisService.stoppingLinking();
        }
      },
    });
  }

  /**
   * When the user is actively dragging a link, listens for keydown events so we can enable
   * shortcuts.
   *
   * Is only accessible if both `CONFIG_FAST_REROUTE_ENABLED` is true, and
   * CONFIG_KEY_CREATE_WHILE_LINKING is not falsy/empty.
   */
  private startingLinking() {
    this.isFastLinking = true;
    window.addEventListener("keydown", this.handleLinkingKeydownBound);
    window.addEventListener("keyup", this.handleLinkingKeyupBound);
  }

  /**
   * When the user stops actively dragging a link, cleans up motnioring data and events.
   *
   * Is only accessible if both `CONFIG_FAST_REROUTE_ENABLED` is true, and
   * CONFIG_KEY_CREATE_WHILE_LINKING is not falsy/empty.
   */
  private stoppingLinking() {
    this.isFastLinking = false;
    this.fastReroutesHistory = [];
    window.removeEventListener("keydown", this.handleLinkingKeydownBound);
    window.removeEventListener("keyup", this.handleLinkingKeyupBound);
  }

  /**
   * Handles the keydown event.
   *
   * Is only accessible if both `CONFIG_FAST_REROUTE_ENABLED` is true, and
   * CONFIG_KEY_CREATE_WHILE_LINKING is not falsy/empty.
   */
  private handleLinkingKeydown(event: KeyboardEvent) {
    if (
      !this.handledNewRerouteKeypress &&
      rgthree.areAllKeysDown(CONFIG_KEY_CREATE_WHILE_LINKING.split("+"))
    ) {
      this.handledNewRerouteKeypress = true;
      this.insertNewRerouteWhileLinking();
    }
  }

  /**
   * Handles the keyup event.
   *
   * Is only accessible if both `CONFIG_FAST_REROUTE_ENABLED` is true, and
   * CONFIG_KEY_CREATE_WHILE_LINKING is not falsy/empty.
   */
  private handleLinkingKeyup(event: KeyboardEvent) {
    if (
      this.handledNewRerouteKeypress &&
      !rgthree.areAllKeysDown(CONFIG_KEY_CREATE_WHILE_LINKING.split("+"))
    ) {
      this.handledNewRerouteKeypress = false;
    }
  }

  /**
   * Inserts a new reroute (while linking) as called from key down handler.
   *
   * Is only accessible if both `CONFIG_FAST_REROUTE_ENABLED` is true, and
   * CONFIG_KEY_CREATE_WHILE_LINKING is not falsy/empty.
   */
  private insertNewRerouteWhileLinking() {
    const canvas = app.canvas as TLGraphCanvas;
    // These should always be true, but this ensures TypeScript.
    if (
      !canvas.connecting_node ||
      !canvas.connecting_pos ||
      !(canvas.connecting_input || canvas.connecting_output)
    ) {
      throw new Error("Error, handling linkining keydown, but there's no link.");
    }

    const node = LiteGraph.createNode("Reroute (rgthree)") as RerouteNode;
    const entry: FastRerouteEntry = {
      node,
      context: {
        connecting_node: canvas.connecting_node,
        connecting_input: canvas.connecting_input,
        connecting_output: canvas.connecting_output,
        connecting_slot: canvas.connecting_slot,
        connecting_pos: [...canvas.connecting_pos],
      },
    };
    this.fastReroutesHistory.push(entry);

    let connectingDir = (canvas.connecting_input || canvas.connecting_output)?.dir;
    if (!connectingDir) {
      connectingDir = canvas.connecting_input ? LiteGraph.LEFT : LiteGraph.RIGHT;
    }

    let newPos = canvas.convertEventToCanvasOffset({
      clientX: Math.round(canvas.last_mouse_position[0] / 10) * 10,
      clientY: Math.round(canvas.last_mouse_position[1] / 10) * 10,
    });
    entry.node.pos = newPos;
    canvas.graph.add(entry.node);
    canvas.selectNode(entry.node);

    // Find out which direction we're generally moving.
    const distX = entry.node.pos[0] - canvas.connecting_pos[0];
    const distY = entry.node.pos[1] - canvas.connecting_pos[1];

    const layout: [string, string] = ["Left", "Right"];
    if (distX > 0 && Math.abs(distX) > Math.abs(distY)) {
      // To the right, and further right than up or down.
      layout[0] = canvas.connecting_output ? "Left" : "Right";
      layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]]!;
      node.pos[0] -= (node.size[0] + 10);
      node.pos[1] -= (Math.round((node.size[1] / 2) / 10) * 10);

    } else if (distX < 0 && Math.abs(distX) > Math.abs(distY)) {
      // To the left, and further right than up or down.
      layout[0] = canvas.connecting_output ? "Right" : "Left";
      layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]]!;
      node.pos[1] -= (Math.round((node.size[1] / 2) / 10) * 10);

    } else if (distY < 0 && Math.abs(distY) > Math.abs(distX)) {
      // Above and further above than left or right.
      layout[0] = canvas.connecting_output ? "Bottom" : "Top";
      layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]]!;
      node.pos[0] -= (Math.round((node.size[0] / 2) / 10) * 10);

    } else if (distY > 0 && Math.abs(distY) > Math.abs(distX)) {
      // Below and further below than left or right.
      layout[0] = canvas.connecting_output ? "Top" : "Bottom";
      layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]]!;
      node.pos[0] -= (Math.round((node.size[0] / 2) / 10) * 10);
      node.pos[1] -= (node.size[1] + 10);
    }
    setConnectionsLayout(entry.node, layout);

    if (canvas.connecting_output) {
      canvas.connecting_node.connect(canvas.connecting_slot, entry.node, 0);
      canvas.connecting_node = entry.node;
      canvas.connecting_output = entry.node.outputs[0]!;
      canvas.connecting_slot = 0;
      canvas.connecting_pos = entry.node.getConnectionPos(false, 0);
    } else {
      entry.node.connect(0, canvas.connecting_node, canvas.connecting_slot);
      canvas.connecting_node = entry.node;
      canvas.connecting_input = entry.node.inputs[0]!;
      canvas.connecting_slot = 0;
      canvas.connecting_pos = entry.node.getConnectionPos(true, 0);
    }

    entry.context.connecting_node = canvas.connecting_node;
    entry.context.connecting_input = canvas.connecting_input;
    entry.context.connecting_output = canvas.connecting_output;
    entry.context.connecting_slot = canvas.connecting_slot;
    entry.context.connecting_pos = [...canvas.connecting_pos];

    app.graph.setDirtyCanvas(true, true);
  }

  /**
   * Is called from a reroute node when it is resized or moved so the service can check if we're
   * actively linking to it, and it can update the linking data so the connection moves too, by
   * updating `connecting_pos`.
   */
  handleMoveOrResizeNodeMaybeWhileDragging(node: RerouteNode) {
    const canvas = app.canvas as TLGraphCanvas;
    if (this.isFastLinking && node === canvas.connecting_node) {
      const entry = this.fastReroutesHistory[this.fastReroutesHistory.length - 1];
      if (entry) {
        canvas.connecting_pos = entry.node.getConnectionPos(!!canvas.connecting_input, 0);
      }
    }
  }

  /**
   * Is called from a reroute node when it is deleted so the service can check if we're actively
   * linking to it and go "back" in history to the previous node.
   */
  handleRemovedNodeMaybeWhileDragging(node: RerouteNode) {
    const lastEntry = this.fastReroutesHistory[this.fastReroutesHistory.length - 1];
    const prevEntry = this.fastReroutesHistory[this.fastReroutesHistory.length - 2];
    if (prevEntry && lastEntry && lastEntry.node === node) {
      const canvas = app.canvas as TLGraphCanvas;
      canvas.connecting_node = prevEntry.context.connecting_node;
      canvas.connecting_input = prevEntry.context.connecting_input;
      canvas.connecting_output = prevEntry.context.connecting_output;
      canvas.connecting_slot = prevEntry.context.connecting_slot;
      canvas.connecting_pos = [...prevEntry.context.connecting_pos];
      this.fastReroutesHistory.splice(this.fastReroutesHistory.length - 1, 1);
      if (prevEntry?.node instanceof RerouteNode) {
        canvas.selectNode(prevEntry!.node);
      }
    }
  }
}

const SERVICE = new RerouteService();

/**
 * The famous ReroutNode, that has true multidirectional, expansive sizes, etc.
 */
class RerouteNode extends RgthreeBaseNode {

  static override title = "Reroute (rgthree)";

  static readonly title_mode = LiteGraph.NO_TITLE;

  static collapsable = false;
  static layout_slot_offset = 5;
  static size: Vector2 = configDefaultSize; // Starting size, read from within litegraph.core

  override isVirtualNode = true;
  readonly hideSlotLabels = true;

  private schedulePromise: Promise<void> | null = null;

  defaultConnectionsLayout = configLayout;

  /** Shortcuts defined in the config. */
  private shortcuts = {
    rotate: { keys: CONFIG_KEY_ROTATE, state: false },
    connection_input: { keys: CONFIG_KEY_CXN_INPUT, state: false },
    connection_output: { keys: CONFIG_KEY_CXN_OUTPUT, state: false },
    resize: {
      keys: CONFIG_KEY_RESIZE,
      state: false,
      initialMousePos: [-1, -1] as Vector2,
      initialNodeSize: [-1, -1] as Vector2,
      initialNodePos: [-1, -1] as Vector2,
      resizeOnSide: [-1, -1] as Vector2,
    },
    move: {
      keys: CONFIG_KEY_MOVE,
      state: false,
      initialMousePos: [-1, -1] as Vector2,
      initialNodePos: [-1, -1] as Vector2,
    },
  };

  constructor(title = RerouteNode.title) {
    super(title);
    this.setResizable(this.properties["resizable"] ?? configResizable);
    this.size = RerouteNode.size; // Starting size.
    this.addInput("", "*");
    this.addOutput("", "*");
    setTimeout(() => this.applyNodeSize(), 20);
  }

  override configure(info: SerializedLGraphNode) {
    this.configuring = true;
    super.configure(info);
    this.setResizable(this.properties["resizable"] ?? configResizable);
    this.applyNodeSize();
    this.configuring = false;
  }

  setResizable(resizable: boolean) {
    this.properties["resizable"] = !!resizable;
    this.resizable = this.properties["resizable"];
  }

  override clone() {
    const cloned = super.clone();
    cloned.inputs[0]!.type = "*";
    cloned.outputs[0]!.type = "*";
    return cloned;
  }

  /**
   * Copied a good bunch of this from the original reroute included with comfy.
   */
  override onConnectionsChange(
    type: number,
    _slotIndex: number,
    connected: boolean,
    _link_info: LLink,
    _ioSlot: INodeOutputSlot | INodeInputSlot,
  ) {
    // Prevent multiple connections to different types when we have no input
    if (connected && type === LiteGraph.OUTPUT) {
      // Ignore wildcard nodes as these will be updated to real types
      const types = new Set(
        this.outputs[0]!.links!.map((l) => app.graph.links[l].type).filter((t) => t !== "*"),
      );
      if (types.size > 1) {
        const linksToDisconnect = [];
        for (let i = 0; i < this.outputs[0]!.links!.length - 1; i++) {
          const linkId = this.outputs[0]!.links![i];
          const link = app.graph.links[linkId];
          linksToDisconnect.push(link);
        }
        for (const link of linksToDisconnect) {
          const node = app.graph.getNodeById(link.target_id);
          node.disconnectInput(link.target_slot);
        }
      }
    }
    this.scheduleStabilize();
  }

  override onDrawForeground(ctx: CanvasRenderingContext2D, canvas: TLGraphCanvas): void {
    if (this.properties?.["showLabel"]) {
      // ComfyUI seemed to break us again, but couldn't repro. No reason to not check, I guess.
      // https://github.com/rgthree/rgthree-comfy/issues/71
      const low_quality = canvas?.ds?.scale && canvas.ds.scale < 0.6;
      if (low_quality || this.size[0] <= 10) {
        return;
      }
      const fontSize = Math.min(14, (this.size[1] * 0.65) | 0);
      ctx.save();
      ctx.fillStyle = "#888";
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        String(
          this.title && this.title !== RerouteNode.title
            ? this.title
            : this.outputs?.[0]?.type || "",
        ),
        this.size[0] / 2,
        this.size[1] / 2,
        this.size[0] - 30,
      );
      ctx.restore();
    }
  }

  override disconnectOutput(slot: string | number, targetNode?: TLGraphNode | undefined): boolean {
    return super.disconnectOutput(slot, targetNode);
  }

  scheduleStabilize(ms = 64) {
    if (!this.schedulePromise) {
      this.schedulePromise = new Promise((resolve) => {
        setTimeout(() => {
          this.schedulePromise = null;
          this.stabilize();
          resolve();
        }, ms);
      });
    }
    return this.schedulePromise;
  }

  stabilize() {
    // If we are currently "configuring" then skip this stabilization. The connected nodes may
    // not yet be configured.
    if (this.configuring) {
      return;
    }
    // Find root input
    let currentNode: TLGraphNode | null = this;
    let updateNodes = [];
    let input = null;
    let inputType = null;
    let inputNode = null;
    let inputNodeOutputSlot = null;
    while (currentNode) {
      updateNodes.unshift(currentNode);
      const linkId: number | null = currentNode.inputs[0]!.link;
      if (linkId !== null) {
        const link: LLink = (app.graph as LGraph).links[linkId]!;
        const node: TLGraphNode = (app.graph as LGraph).getNodeById(link.origin_id)!;
        if (!node) {
          // Bummer, somthing happened.. should we cleanup?
          app.graph.removeLink(linkId);
          currentNode = null;
          break;
        }
        const type = (node.constructor as typeof TLGraphNode).type;
        if (type?.includes("Reroute")) {
          if (node === this) {
            // We've found a circle
            currentNode.disconnectInput(link.target_slot);
            currentNode = null;
          } else {
            // Move the previous node
            currentNode = node;
          }
        } else {
          // We've found the end
          inputNode = node;
          inputNodeOutputSlot = link.origin_slot;
          input = node.outputs[inputNodeOutputSlot] ?? null;
          inputType = input?.type ?? null;
          break;
        }
      } else {
        // This path has no input node
        currentNode = null;
        break;
      }
    }

    // Find all outputs
    const nodes: TLGraphNode[] = [this];
    let outputNode = null;
    let outputType = null;
    while (nodes.length) {
      currentNode = nodes.pop()!;
      const outputs = (currentNode.outputs ? currentNode.outputs[0]!.links : []) || [];
      if (outputs.length) {
        for (const linkId of outputs) {
          const link = app.graph.links[linkId];

          // When disconnecting sometimes the link is still registered
          if (!link) continue;

          const node = app.graph.getNodeById(link.target_id) as TLGraphNode;
          // Don't know why this ever happens.. but it did around the repeater..
          if (!node) continue;
          const type = (node.constructor as any).type;
          if (type?.includes("Reroute")) {
            // Follow reroute nodes
            nodes.push(node);
            updateNodes.push(node);
          } else {
            // We've found an output
            const output = node.inputs?.[link.target_slot] ?? null;
            const nodeOutType = output?.type;
            if (nodeOutType == null) {
              console.warn(
                `[rgthree] Reroute - Connected node ${node.id} does not have type information for ` +
                  `slot ${link.target_slot}. Skipping connection enforcement, but something is odd ` +
                  `with that node.`,
              );
            } else if (
              inputType &&
              inputType !== "*" &&
              nodeOutType !== "*" &&
              !isValidConnection(input, output)
            ) {
              // The output doesnt match our input so disconnect it
              console.warn(
                `[rgthree] Reroute - Disconnecting connected node's input (${node.id}.${
                  link.target_slot
                }) (${node.type}) because its type (${String(
                  nodeOutType,
                )}) does not match the reroute type (${String(inputType)})`,
              );
              node.disconnectInput(link.target_slot);
            } else {
              outputType = nodeOutType;
              outputNode = node;
            }
          }
        }
      } else {
        // No more outputs for this path
      }
    }

    const displayType = inputType || outputType || "*";
    const color = LGraphCanvas.link_type_colors[displayType];

    // Update the types of each node
    for (const node of updateNodes) {
      // If we dont have an input type we are always wildcard but we'll show the output type
      // This lets you change the output link to a different type and all nodes will update
      node.outputs[0]!.type = inputType || "*";
      (node as any).__outputType = displayType;
      node.outputs[0]!.name = input?.name || "";
      node.size = node.computeSize();
      (node as any).applyNodeSize?.();

      for (const l of node.outputs[0]!.links || []) {
        const link = app.graph.links[l];
        if (link) {
          link.color = color;
        }
      }
    }

    if (inputNode && inputNodeOutputSlot != null) {
      const links = inputNode.outputs[inputNodeOutputSlot]!.links;
      for (const l of links || []) {
        const link = app.graph.links[l];
        if (link) {
          link.color = color;
        }
      }
    }
    (inputNode as any)?.onConnectionsChainChange?.();
    (outputNode as any)?.onConnectionsChainChange?.();
    app.graph.setDirtyCanvas(true, true);
  }

  /**
   * When called, sets the node size, and the properties size, and calls out to `stabilizeLayout`.
   */
  override setSize(size: Vector2): void {
    const oldSize: Vector2 = [...this.size];
    const newSize: Vector2 = [...size];
    super.setSize(newSize);
    this.properties["size"] = [...this.size];
    this.stabilizeLayout(oldSize, newSize);
  }

  /**
   * Looks at the current layout and determins if we also need to set a `connections_dir` based on
   * the size of the node (and what that connections_dir should be).
   */
  private stabilizeLayout(oldSize: Vector2, newSize: Vector2) {
    if (newSize[0] === 10 || newSize[1] === 10) {
      this.properties = this.properties || {};
      const props = this.properties;
      props["connections_layout"] = props["connections_layout"] || ["Left", "Right"];
      const layout = props["connections_layout"];
      props["connections_dir"] = props["connections_dir"] || [-1, -1];
      const dir = props["connections_dir"];

      if (oldSize[0] > 10 && newSize[0] === 10) {
        dir[0] = LiteGraph.DOWN;
        dir[1] = LiteGraph.UP;
        if (layout[0] === "Bottom") {
          layout[1] = "Top";
        } else if (layout[1] === "Top") {
          layout[0] = "Bottom";
        } else {
          layout[0] = "Top";
          layout[1] = "Bottom";
          dir[0] = LiteGraph.UP;
          dir[1] = LiteGraph.DOWN;
        }
        this.setDirtyCanvas(true, true);
      } else if (oldSize[1] > 10 && newSize[1] === 10) {
        dir[0] = LiteGraph.RIGHT;
        dir[1] = LiteGraph.LEFT;
        if (layout[0] === "Right") {
          layout[1] = "Left";
        } else if (layout[1] === "Left") {
          layout[0] = "Right";
        } else {
          layout[0] = "Left";
          layout[1] = "Right";
          dir[0] = LiteGraph.LEFT;
          dir[1] = LiteGraph.RIGHT;
        }
        this.setDirtyCanvas(true, true);
      }
    }
    SERVICE.handleMoveOrResizeNodeMaybeWhileDragging(this);
  }

  applyNodeSize() {
    this.properties["size"] = this.properties["size"] || RerouteNode.size;
    this.properties["size"] = [
      Number(this.properties["size"][0]),
      Number(this.properties["size"][1]),
    ];
    this.size = this.properties["size"];
    app.graph.setDirtyCanvas(true, true);
  }

  /**
   * Rotates the node, including changing size and moving input's and output's layouts.
   */
  rotate(degrees: 90 | -90 | 180) {
    const w = this.size[0];
    const h = this.size[1];
    this.properties["connections_layout"] =
      this.properties["connections_layout"] || (this as RerouteNode).defaultConnectionsLayout;
    const inputDirIndex = LAYOUT_CLOCKWISE.indexOf(this.properties["connections_layout"][0]);
    const outputDirIndex = LAYOUT_CLOCKWISE.indexOf(this.properties["connections_layout"][1]);
    if (degrees == 90 || degrees === -90) {
      if (degrees === -90) {
        this.properties["connections_layout"][0] =
          LAYOUT_CLOCKWISE[(((inputDirIndex - 1) % 4) + 4) % 4];
        this.properties["connections_layout"][1] =
          LAYOUT_CLOCKWISE[(((outputDirIndex - 1) % 4) + 4) % 4];
      } else {
        this.properties["connections_layout"][0] =
          LAYOUT_CLOCKWISE[(((inputDirIndex + 1) % 4) + 4) % 4];
        this.properties["connections_layout"][1] =
          LAYOUT_CLOCKWISE[(((outputDirIndex + 1) % 4) + 4) % 4];
      }
    } else if (degrees === 180) {
      this.properties["connections_layout"][0] =
        LAYOUT_CLOCKWISE[(((inputDirIndex + 2) % 4) + 4) % 4];
      this.properties["connections_layout"][1] =
        LAYOUT_CLOCKWISE[(((outputDirIndex + 2) % 4) + 4) % 4];
    }
    this.setSize([h, w]);
  }

  /**
   * Manually handles a move called from `onMouseMove` while the resize shortcut is active.
   */
  private manuallyHandleMove(event: PointerEvent) {
    const shortcut = this.shortcuts.move;
    if (shortcut.state) {
      const diffX = Math.round((event.clientX - shortcut.initialMousePos[0]) / 10) * 10;
      const diffY = Math.round((event.clientY - shortcut.initialMousePos[1]) / 10) * 10;
      this.pos[0] = shortcut.initialNodePos[0] + diffX;
      this.pos[1] = shortcut.initialNodePos[1] + diffY;
      this.setDirtyCanvas(true, true);
      SERVICE.handleMoveOrResizeNodeMaybeWhileDragging(this);
    }
  }

  /**
   * Manually handles a resize called from `onMouseMove` while the resize shortcut is active.
   */
  private manuallyHandleResize(event: PointerEvent) {
    const shortcut = this.shortcuts.resize;
    if (shortcut.state) {
      let diffX = Math.round((event.clientX - shortcut.initialMousePos[0]) / 10) * 10;
      let diffY = Math.round((event.clientY - shortcut.initialMousePos[1]) / 10) * 10;
      diffX *= shortcut.resizeOnSide[0] === LiteGraph.LEFT ? -1 : 1;
      diffY *= shortcut.resizeOnSide[1] === LiteGraph.UP ? -1 : 1;
      const oldSize: Vector2 = [...this.size];
      this.setSize([
        Math.max(10, shortcut.initialNodeSize[0] + diffX),
        Math.max(10, shortcut.initialNodeSize[1] + diffY),
      ]);
      if (shortcut.resizeOnSide[0] === LiteGraph.LEFT && oldSize[0] > 10) {
        this.pos[0] = shortcut.initialNodePos[0] - diffX;
      }
      if (shortcut.resizeOnSide[1] === LiteGraph.UP && oldSize[1] > 10) {
        this.pos[1] = shortcut.initialNodePos[1] - diffY;
      }
      this.setDirtyCanvas(true, true);
    }
  }

  /**
   * Cycles the connection (input or output) to the next available layout. Note, when the width or
   * height is only 10px, then layout sticks to the ends of the longer size, and we move a
   * `connections_dir` property which is only paid attention to in `utils` when size of one axis
   * is equal to 10.
   * `manuallyHandleResize` handles the reset of `connections_dir` when a node is resized.
   */
  private cycleConnection(ioDir: IoDirection) {
    this.properties = this.properties || {};
    const props = this.properties;
    props["connections_layout"] = props["connections_layout"] || ["Left", "Right"];
    const propIdx = ioDir == IoDirection.INPUT ? 0 : 1;
    const oppositeIdx = propIdx ? 0 : 1;
    let currentLayout = props["connections_layout"][propIdx];
    let oppositeLayout = props["connections_layout"][oppositeIdx];

    if (this.size[0] === 10 || this.size[1] === 10) {
      props["connections_dir"] = props["connections_dir"] || [-1, -1];
      let currentDir = props["connections_dir"][propIdx] as number;
      // let oppositeDir = props["connections_dir"][oppositeIdx];
      const options: number[] =
        this.size[0] === 10
          ? currentLayout === "Bottom"
            ? [LiteGraph.DOWN, LiteGraph.RIGHT, LiteGraph.LEFT]
            : [LiteGraph.UP, LiteGraph.LEFT, LiteGraph.RIGHT]
          : currentLayout === "Right"
          ? [LiteGraph.RIGHT, LiteGraph.DOWN, LiteGraph.UP]
          : [LiteGraph.LEFT, LiteGraph.UP, LiteGraph.DOWN];
      let idx = options.indexOf(currentDir);
      let next = options[idx + 1] ?? options[0]!;
      this.properties["connections_dir"][propIdx] = next;
      return;
    }

    let next = currentLayout;
    do {
      let idx = LAYOUT_CLOCKWISE.indexOf(next);
      next = LAYOUT_CLOCKWISE[idx + 1] ?? LAYOUT_CLOCKWISE[0]!;
    } while (next === oppositeLayout);
    this.properties["connections_layout"][propIdx] = next;
    this.setDirtyCanvas(true, true);
  }

  /**
   * Handles a mouse move while this node is selected. Note, though, that the actual work here is
   * processed bycause the move and resize shortcuts set `canvas.node_capturing_input` to this node
   * when they start (otherwise onMouseMove only fires when the mouse moves within the node's
   * bounds).
   */
  override onMouseMove(event: PointerEvent): void {
    if (this.shortcuts.move.state) {
      const shortcut = this.shortcuts.move;
      if (shortcut.initialMousePos[0] === -1) {
        shortcut.initialMousePos[0] = event.clientX;
        shortcut.initialMousePos[1] = event.clientY;
        shortcut.initialNodePos[0] = this.pos[0];
        shortcut.initialNodePos[1] = this.pos[1];
      }
      this.manuallyHandleMove(event);
    } else if (this.shortcuts.resize.state) {
      const shortcut = this.shortcuts.resize;
      if (shortcut.initialMousePos[0] === -1) {
        shortcut.initialMousePos[0] = event.clientX;
        shortcut.initialMousePos[1] = event.clientY;
        shortcut.initialNodeSize[0] = this.size[0];
        shortcut.initialNodeSize[1] = this.size[1];
        shortcut.initialNodePos[0] = this.pos[0];
        shortcut.initialNodePos[1] = this.pos[1];
        const canvas = app.canvas as TLGraphCanvas;
        const offset = canvas.convertEventToCanvasOffset(event);
        shortcut.resizeOnSide[0] = this.pos[0] > offset[0] ? LiteGraph.LEFT : LiteGraph.RIGHT;
        shortcut.resizeOnSide[1] = this.pos[1] > offset[1] ? LiteGraph.UP : LiteGraph.DOWN;
      }
      this.manuallyHandleResize(event);
    }
  }

  /**
   * Handles a key down while this node is selected, starting a shortcut if the keys are newly
   * pressed.
   */
  override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    const canvas = app.canvas as TLGraphCanvas;

    // Only handle shortcuts while we're enabled in the config.
    if (CONFIG_FAST_REROUTE_ENABLED) {
      for (const [key, shortcut] of Object.entries(this.shortcuts)) {
        if (!shortcut.state) {
          const keys = rgthree.areAllKeysDown(shortcut.keys.split("+"));
          if (keys) {
            shortcut.state = true;
            if (key === "rotate") {
              this.rotate(90);
            } else if (key.includes("connection")) {
              this.cycleConnection(key.includes("input") ? IoDirection.INPUT : IoDirection.OUTPUT);
            }
            if ((shortcut as any).initialMousePos) {
              canvas.node_capturing_input = this;
            }
          }
        }
      }
    }
  }

  /**
   * Handles a key up while this node is selected, canceling any current shortcut.
   */
  override onKeyUp(event: KeyboardEvent): void {
    super.onKeyUp(event);
    const canvas = app.canvas as TLGraphCanvas;

    // Only handle shortcuts while we're enabled in the config.
    if (CONFIG_FAST_REROUTE_ENABLED) {
      for (const [key, shortcut] of Object.entries(this.shortcuts)) {
        if (shortcut.state) {
          const keys = rgthree.areAllKeysDown(shortcut.keys.split("+"));
          if (!keys) {
            shortcut.state = false;
            if ((shortcut as any).initialMousePos) {
              (shortcut as any).initialMousePos = [-1, -1];
              if ((canvas.node_capturing_input = this)) {
                canvas.node_capturing_input = null;
              }
              this.setDirtyCanvas(true, true);
            }
          }
        }
      }
    }
  }

  /**
   * Handles a deselection of the node, canceling any current shortcut.
   */
  override onDeselected(): void {
    super.onDeselected?.();
    const canvas = app.canvas as TLGraphCanvas;
    for (const [key, shortcut] of Object.entries(this.shortcuts)) {
      shortcut.state = false;
      if ((shortcut as any).initialMousePos) {
        (shortcut as any).initialMousePos = [-1, -1];
        if ((canvas.node_capturing_input = this)) {
          canvas.node_capturing_input = null;
        }
        this.setDirtyCanvas(true, true);
      }
    }
  }

  override onRemoved(): void {
    super.onRemoved?.();
    // If we're removed, let's call out to the link dragging above. In a settimeout because this is
    // called as we're removing with further cleanup Litegraph does, and we want the handler to
    // cleanup further, afterwards
    setTimeout(() => {
      SERVICE.handleRemovedNodeMaybeWhileDragging(this);
    }, 32);
  }

  override getHelp() {
    return `
      <p>
        Finally, a comfortable, powerful reroute node with true multi-direction and powerful
        shortcuts to bring your workflow to the next level.
      </p>

      ${!CONFIG_FAST_REROUTE_ENABLED
        ?
        `<p><i>Fast Shortcuts are currently disabled.</b>`
        :
        `
        <ul>
          <li><p>
            <code>${CONFIG_KEY_CREATE_WHILE_LINKING}</code> Create a new reroute node while dragging
            a link, connecting it to the link in the place and continuing the link.
          </p></li>
          <li><p>
            <code>${CONFIG_KEY_ROTATE}</code> Rotate the selected reroute node counter clockwise 90
            degrees.
          </p></li>
          <li><p>
            <code>${CONFIG_KEY_RESIZE}</code> Resize the selected reroute node from the nearest
            corner by holding down and moving your mouse.
          </p></li>
          <li><p>
            <code>${CONFIG_KEY_MOVE}</code> Move the selected reroute node by holding down and
            moving your mouse.
          </p></li>
          <li><p>
            <code>${CONFIG_KEY_CXN_INPUT}</code> Change the input layout/direction of the selected
            reroute node.
          </p></li>
          <li><p>
            <code>${CONFIG_KEY_CXN_OUTPUT}</code> Change the output layout/direction of the selected
            reroute node.
          </p></li>
        </ul>
      `}
      <p><small>
        To change, ${!CONFIG_FAST_REROUTE_ENABLED ? 'enable':'disable'} or configure sohrtcuts,
        make a copy of
        <code>/custom_nodes/rgthree-comfy/rgthree_config.json.default</code> to
        <code>/custom_nodes/rgthree-comfy/rgthree_config.json</code> and configure under
        <code>nodes > reroute > fast_reroute</code>.
      </small></p>
    `;
  }
}

addMenuItem(RerouteNode, app, {
  name: (node) => `${node.properties?.["showLabel"] ? "Hide" : "Show"} Label/Title`,
  property: "showLabel",
  callback: async (node, value) => {
    app.graph.setDirtyCanvas(true, true);
  },
});

addMenuItem(RerouteNode, app, {
  name: (node) => `${node.resizable ? "No" : "Allow"} Resizing`,
  callback: (node) => {
    (node as RerouteNode).setResizable(!node.resizable);
    node.size[0] = Math.max(40, node.size[0]);
    node.size[1] = Math.max(30, node.size[1]);
    (node as RerouteNode).applyNodeSize();
  },
});

addMenuItem(RerouteNode, app, {
  name: "Static Width",
  property: "size",
  subMenuOptions: (() => {
    const options = [];
    for (let w = 8; w > 0; w--) {
      options.push(`${w * 10}`);
    }
    return options;
  })(),
  prepareValue: (value, node) => [Number(value), node.size[1]],
  callback: (node) => {
    (node as RerouteNode).setResizable(false);
    (node as RerouteNode).applyNodeSize();
  },
});

addMenuItem(RerouteNode, app, {
  name: "Static Height",
  property: "size",
  subMenuOptions: (() => {
    const options = [];
    for (let w = 8; w > 0; w--) {
      options.push(`${w * 10}`);
    }
    return options;
  })(),
  prepareValue: (value, node) => [node.size[0], Number(value)],
  callback: (node) => {
    (node as RerouteNode).setResizable(false);
    (node as RerouteNode).applyNodeSize();
  },
});

addConnectionLayoutSupport(
  RerouteNode,
  app,
  [
    ["Left", "Right"],
    ["Left", "Top"],
    ["Left", "Bottom"],
    ["Right", "Left"],
    ["Right", "Top"],
    ["Right", "Bottom"],
    ["Top", "Left"],
    ["Top", "Right"],
    ["Top", "Bottom"],
    ["Bottom", "Left"],
    ["Bottom", "Right"],
    ["Bottom", "Top"],
  ],
  (node) => {
    (node as RerouteNode).applyNodeSize();
  },
);

addMenuItem(RerouteNode, app, {
  name: "Rotate",
  subMenuOptions: [
    "Rotate 90° Clockwise",
    "Rotate 90° Counter-Clockwise",
    "Rotate 180°",
    null,
    "Flip Horizontally",
    "Flip Vertically",
  ],
  callback: (node_: TLGraphNode, value) => {
    const node = node_ as RerouteNode;
    if (value?.startsWith("Rotate 90° Clockwise")) {
      node.rotate(90);
    } else if (value?.startsWith("Rotate 90° Counter-Clockwise")) {
      node.rotate(-90);
    } else if (value?.startsWith("Rotate 180°")) {
      node.rotate(180);
    } else {
      const inputDirIndex = LAYOUT_CLOCKWISE.indexOf(node.properties["connections_layout"][0]);
      const outputDirIndex = LAYOUT_CLOCKWISE.indexOf(node.properties["connections_layout"][1]);
      if (value?.startsWith("Flip Horizontally")) {
        if (["Left", "Right"].includes(node.properties["connections_layout"][0])) {
          node.properties["connections_layout"][0] =
            LAYOUT_CLOCKWISE[(((inputDirIndex + 2) % 4) + 4) % 4];
        }
        if (["Left", "Right"].includes(node.properties["connections_layout"][1])) {
          node.properties["connections_layout"][1] =
            LAYOUT_CLOCKWISE[(((outputDirIndex + 2) % 4) + 4) % 4];
        }
      } else if (value?.startsWith("Flip Vertically")) {
        if (["Top", "Bottom"].includes(node.properties["connections_layout"][0])) {
          node.properties["connections_layout"][0] =
            LAYOUT_CLOCKWISE[(((inputDirIndex + 2) % 4) + 4) % 4];
        }
        if (["Top", "Bottom"].includes(node.properties["connections_layout"][1])) {
          node.properties["connections_layout"][1] =
            LAYOUT_CLOCKWISE[(((outputDirIndex + 2) % 4) + 4) % 4];
        }
      }
    }
  },
});

addMenuItem(RerouteNode, app, {
  name: "Clone New Reroute...",
  subMenuOptions: ["Before", "After"],
  callback: async (node, value) => {
    const clone = node.clone();
    const pos = [...node.pos];
    if (value === "Before") {
      clone.pos = [pos[0]! - 20, pos[1]! - 20];
      app.graph.add(clone);
      await wait();
      const inputLinks = getSlotLinks(node.inputs[0]);
      for (const inputLink of inputLinks) {
        const link = inputLink.link;
        const linkedNode = app.graph.getNodeById(link.origin_id) as TLGraphNode;
        if (linkedNode) {
          linkedNode.connect(0, clone, 0);
        }
      }
      clone.connect(0, node, 0);
    } else {
      clone.pos = [pos[0]! + 20, pos[1]! + 20];
      app.graph.add(clone);
      await wait();
      const outputLinks = getSlotLinks(node.outputs[0]);
      node.connect(0, clone, 0);
      for (const outputLink of outputLinks) {
        const link = outputLink.link;
        const linkedNode = app.graph.getNodeById(link.target_id) as TLGraphNode;
        if (linkedNode) {
          clone.connect(0, linkedNode, link.target_slot);
        }
      }
    }
  },
});

app.registerExtension({
  name: "rgthree.Reroute",
  registerCustomNodes() {
    LiteGraph.registerNodeType(RerouteNode.title, RerouteNode);
    RerouteNode.category = RerouteNode._category;
  },
});
