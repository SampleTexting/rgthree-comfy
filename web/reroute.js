var _a, _b;
import { app } from "../../scripts/app.js";
import { rgthreeConfig } from "./rgthree_config.js";
import { rgthree } from "./rgthree.js";
import { IoDirection, LAYOUT_CLOCKWISE, LAYOUT_LABEL_OPPOSITES, LAYOUT_LABEL_TO_DATA, addConnectionLayoutSupport, addMenuItem, getSlotLinks, isValidConnection, setConnectionsLayout, waitForCanvas, } from "./utils.js";
import { wait } from "./shared_utils.js";
import { RgthreeBaseNode } from "./base_node.js";
const CONFIG_REROUTE = ((_a = rgthreeConfig === null || rgthreeConfig === void 0 ? void 0 : rgthreeConfig["nodes"]) === null || _a === void 0 ? void 0 : _a["reroute"]) || {};
const CONFIG_FAST_REROUTE = CONFIG_REROUTE["fast_reroute"];
const CONFIG_FAST_REROUTE_ENABLED = (_b = CONFIG_FAST_REROUTE["enabled"]) !== null && _b !== void 0 ? _b : false;
const CONFIG_KEY_CREATE_WHILE_LINKING = CONFIG_FAST_REROUTE["key_create_while_dragging_link"];
const CONFIG_KEY_ROTATE = CONFIG_FAST_REROUTE["key_rotate"];
const CONFIG_KEY_RESIZE = CONFIG_FAST_REROUTE["key_resize"];
const CONFIG_KEY_MOVE = CONFIG_FAST_REROUTE["key_move"];
const CONFIG_KEY_CXN_INPUT = CONFIG_FAST_REROUTE["key_connections_input"];
const CONFIG_KEY_CXN_OUTPUT = CONFIG_FAST_REROUTE["key_connections_output"];
let configWidth = Math.max(Math.round((Number(CONFIG_REROUTE["default_width"]) || 40) / 10) * 10, 10);
let configHeight = Math.max(Math.round((Number(CONFIG_REROUTE["default_height"]) || 30) / 10) * 10, 10);
while (configWidth * configHeight < 400) {
    configWidth += 10;
    configHeight += 10;
}
const configDefaultSize = [configWidth, configHeight];
const configResizable = !!CONFIG_REROUTE["default_resizable"];
let configLayout = CONFIG_REROUTE["default_layout"];
if (!Array.isArray(configLayout)) {
    configLayout = ["Left", "Right"];
}
if (!LAYOUT_LABEL_TO_DATA[configLayout[0]]) {
    configLayout[0] = "Left";
}
if (!LAYOUT_LABEL_TO_DATA[configLayout[1]] || configLayout[0] == configLayout[1]) {
    configLayout[1] = LAYOUT_LABEL_OPPOSITES[configLayout[0]];
}
class RerouteService {
    constructor() {
        this.isFastLinking = false;
        this.handledNewRerouteKeypress = false;
        this.fastReroutesHistory = [];
        this.handleLinkingKeydownBound = this.handleLinkingKeydown.bind(this);
        this.handleLinkingKeyupBound = this.handleLinkingKeyup.bind(this);
        if (CONFIG_FAST_REROUTE_ENABLED && (CONFIG_KEY_CREATE_WHILE_LINKING === null || CONFIG_KEY_CREATE_WHILE_LINKING === void 0 ? void 0 : CONFIG_KEY_CREATE_WHILE_LINKING.trim())) {
            this.onCanvasSetUpListenerForLinking();
        }
    }
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
    startingLinking() {
        this.isFastLinking = true;
        window.addEventListener("keydown", this.handleLinkingKeydownBound);
        window.addEventListener("keyup", this.handleLinkingKeyupBound);
    }
    stoppingLinking() {
        this.isFastLinking = false;
        this.fastReroutesHistory = [];
        window.removeEventListener("keydown", this.handleLinkingKeydownBound);
        window.removeEventListener("keyup", this.handleLinkingKeyupBound);
    }
    handleLinkingKeydown(event) {
        if (!this.handledNewRerouteKeypress &&
            rgthree.areAllKeysDown(CONFIG_KEY_CREATE_WHILE_LINKING.split("+"))) {
            this.handledNewRerouteKeypress = true;
            this.insertNewRerouteWhileLinking();
        }
    }
    handleLinkingKeyup(event) {
        if (this.handledNewRerouteKeypress &&
            !rgthree.areAllKeysDown(CONFIG_KEY_CREATE_WHILE_LINKING.split("+"))) {
            this.handledNewRerouteKeypress = false;
        }
    }
    insertNewRerouteWhileLinking() {
        var _a;
        const canvas = app.canvas;
        if (!canvas.connecting_node ||
            !canvas.connecting_pos ||
            !(canvas.connecting_input || canvas.connecting_output)) {
            throw new Error("Error, handling linkining keydown, but there's no link.");
        }
        const node = LiteGraph.createNode("Reroute (rgthree)");
        const entry = {
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
        let connectingDir = (_a = (canvas.connecting_input || canvas.connecting_output)) === null || _a === void 0 ? void 0 : _a.dir;
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
        const distX = entry.node.pos[0] - canvas.connecting_pos[0];
        const distY = entry.node.pos[1] - canvas.connecting_pos[1];
        const layout = ["Left", "Right"];
        if (distX > 0 && Math.abs(distX) > Math.abs(distY)) {
            layout[0] = canvas.connecting_output ? "Left" : "Right";
            layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]];
            node.pos[0] -= (node.size[0] + 10);
            node.pos[1] -= (Math.round((node.size[1] / 2) / 10) * 10);
        }
        else if (distX < 0 && Math.abs(distX) > Math.abs(distY)) {
            layout[0] = canvas.connecting_output ? "Right" : "Left";
            layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]];
            node.pos[1] -= (Math.round((node.size[1] / 2) / 10) * 10);
        }
        else if (distY < 0 && Math.abs(distY) > Math.abs(distX)) {
            layout[0] = canvas.connecting_output ? "Bottom" : "Top";
            layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]];
            node.pos[0] -= (Math.round((node.size[0] / 2) / 10) * 10);
        }
        else if (distY > 0 && Math.abs(distY) > Math.abs(distX)) {
            layout[0] = canvas.connecting_output ? "Top" : "Bottom";
            layout[1] = LAYOUT_LABEL_OPPOSITES[layout[0]];
            node.pos[0] -= (Math.round((node.size[0] / 2) / 10) * 10);
            node.pos[1] -= (node.size[1] + 10);
        }
        setConnectionsLayout(entry.node, layout);
        if (canvas.connecting_output) {
            canvas.connecting_node.connect(canvas.connecting_slot, entry.node, 0);
            canvas.connecting_node = entry.node;
            canvas.connecting_output = entry.node.outputs[0];
            canvas.connecting_slot = 0;
            canvas.connecting_pos = entry.node.getConnectionPos(false, 0);
        }
        else {
            entry.node.connect(0, canvas.connecting_node, canvas.connecting_slot);
            canvas.connecting_node = entry.node;
            canvas.connecting_input = entry.node.inputs[0];
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
    handleMoveOrResizeNodeMaybeWhileDragging(node) {
        const canvas = app.canvas;
        if (this.isFastLinking && node === canvas.connecting_node) {
            const entry = this.fastReroutesHistory[this.fastReroutesHistory.length - 1];
            if (entry) {
                canvas.connecting_pos = entry.node.getConnectionPos(!!canvas.connecting_input, 0);
            }
        }
    }
    handleRemovedNodeMaybeWhileDragging(node) {
        const lastEntry = this.fastReroutesHistory[this.fastReroutesHistory.length - 1];
        const prevEntry = this.fastReroutesHistory[this.fastReroutesHistory.length - 2];
        if (prevEntry && lastEntry && lastEntry.node === node) {
            const canvas = app.canvas;
            canvas.connecting_node = prevEntry.context.connecting_node;
            canvas.connecting_input = prevEntry.context.connecting_input;
            canvas.connecting_output = prevEntry.context.connecting_output;
            canvas.connecting_slot = prevEntry.context.connecting_slot;
            canvas.connecting_pos = [...prevEntry.context.connecting_pos];
            this.fastReroutesHistory.splice(this.fastReroutesHistory.length - 1, 1);
            if ((prevEntry === null || prevEntry === void 0 ? void 0 : prevEntry.node) instanceof RerouteNode) {
                canvas.selectNode(prevEntry.node);
            }
        }
    }
}
const SERVICE = new RerouteService();
class RerouteNode extends RgthreeBaseNode {
    constructor(title = RerouteNode.title) {
        var _a;
        super(title);
        this.isVirtualNode = true;
        this.hideSlotLabels = true;
        this.schedulePromise = null;
        this.defaultConnectionsLayout = configLayout;
        this.shortcuts = {
            rotate: { keys: CONFIG_KEY_ROTATE, state: false },
            connection_input: { keys: CONFIG_KEY_CXN_INPUT, state: false },
            connection_output: { keys: CONFIG_KEY_CXN_OUTPUT, state: false },
            resize: {
                keys: CONFIG_KEY_RESIZE,
                state: false,
                initialMousePos: [-1, -1],
                initialNodeSize: [-1, -1],
                initialNodePos: [-1, -1],
                resizeOnSide: [-1, -1],
            },
            move: {
                keys: CONFIG_KEY_MOVE,
                state: false,
                initialMousePos: [-1, -1],
                initialNodePos: [-1, -1],
            },
        };
        this.setResizable((_a = this.properties["resizable"]) !== null && _a !== void 0 ? _a : configResizable);
        this.size = RerouteNode.size;
        this.addInput("", "*");
        this.addOutput("", "*");
        setTimeout(() => this.applyNodeSize(), 20);
    }
    configure(info) {
        var _a;
        this.configuring = true;
        super.configure(info);
        this.setResizable((_a = this.properties["resizable"]) !== null && _a !== void 0 ? _a : configResizable);
        this.applyNodeSize();
        this.configuring = false;
    }
    setResizable(resizable) {
        this.properties["resizable"] = !!resizable;
        this.resizable = this.properties["resizable"];
    }
    clone() {
        const cloned = super.clone();
        cloned.inputs[0].type = "*";
        cloned.outputs[0].type = "*";
        return cloned;
    }
    onConnectionsChange(type, _slotIndex, connected, _link_info, _ioSlot) {
        if (connected && type === LiteGraph.OUTPUT) {
            const types = new Set(this.outputs[0].links.map((l) => app.graph.links[l].type).filter((t) => t !== "*"));
            if (types.size > 1) {
                const linksToDisconnect = [];
                for (let i = 0; i < this.outputs[0].links.length - 1; i++) {
                    const linkId = this.outputs[0].links[i];
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
    onDrawForeground(ctx, canvas) {
        var _a, _b, _c, _d;
        if ((_a = this.properties) === null || _a === void 0 ? void 0 : _a["showLabel"]) {
            const low_quality = ((_b = canvas === null || canvas === void 0 ? void 0 : canvas.ds) === null || _b === void 0 ? void 0 : _b.scale) && canvas.ds.scale < 0.6;
            if (low_quality || this.size[0] <= 10) {
                return;
            }
            const fontSize = Math.min(14, (this.size[1] * 0.65) | 0);
            ctx.save();
            ctx.fillStyle = "#888";
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(this.title && this.title !== RerouteNode.title
                ? this.title
                : ((_d = (_c = this.outputs) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.type) || ""), this.size[0] / 2, this.size[1] / 2, this.size[0] - 30);
            ctx.restore();
        }
    }
    disconnectOutput(slot, targetNode) {
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
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (this.configuring) {
            return;
        }
        let currentNode = this;
        let updateNodes = [];
        let input = null;
        let inputType = null;
        let inputNode = null;
        let inputNodeOutputSlot = null;
        while (currentNode) {
            updateNodes.unshift(currentNode);
            const linkId = currentNode.inputs[0].link;
            if (linkId !== null) {
                const link = app.graph.links[linkId];
                const node = app.graph.getNodeById(link.origin_id);
                if (!node) {
                    app.graph.removeLink(linkId);
                    currentNode = null;
                    break;
                }
                const type = node.constructor.type;
                if (type === null || type === void 0 ? void 0 : type.includes("Reroute")) {
                    if (node === this) {
                        currentNode.disconnectInput(link.target_slot);
                        currentNode = null;
                    }
                    else {
                        currentNode = node;
                    }
                }
                else {
                    inputNode = node;
                    inputNodeOutputSlot = link.origin_slot;
                    input = (_a = node.outputs[inputNodeOutputSlot]) !== null && _a !== void 0 ? _a : null;
                    inputType = (_b = input === null || input === void 0 ? void 0 : input.type) !== null && _b !== void 0 ? _b : null;
                    break;
                }
            }
            else {
                currentNode = null;
                break;
            }
        }
        const nodes = [this];
        let outputNode = null;
        let outputType = null;
        while (nodes.length) {
            currentNode = nodes.pop();
            const outputs = (currentNode.outputs ? currentNode.outputs[0].links : []) || [];
            if (outputs.length) {
                for (const linkId of outputs) {
                    const link = app.graph.links[linkId];
                    if (!link)
                        continue;
                    const node = app.graph.getNodeById(link.target_id);
                    if (!node)
                        continue;
                    const type = node.constructor.type;
                    if (type === null || type === void 0 ? void 0 : type.includes("Reroute")) {
                        nodes.push(node);
                        updateNodes.push(node);
                    }
                    else {
                        const output = (_d = (_c = node.inputs) === null || _c === void 0 ? void 0 : _c[link.target_slot]) !== null && _d !== void 0 ? _d : null;
                        const nodeOutType = output === null || output === void 0 ? void 0 : output.type;
                        if (nodeOutType == null) {
                            console.warn(`[rgthree] Reroute - Connected node ${node.id} does not have type information for ` +
                                `slot ${link.target_slot}. Skipping connection enforcement, but something is odd ` +
                                `with that node.`);
                        }
                        else if (inputType &&
                            inputType !== "*" &&
                            nodeOutType !== "*" &&
                            !isValidConnection(input, output)) {
                            console.warn(`[rgthree] Reroute - Disconnecting connected node's input (${node.id}.${link.target_slot}) (${node.type}) because its type (${String(nodeOutType)}) does not match the reroute type (${String(inputType)})`);
                            node.disconnectInput(link.target_slot);
                        }
                        else {
                            outputType = nodeOutType;
                            outputNode = node;
                        }
                    }
                }
            }
            else {
            }
        }
        const displayType = inputType || outputType || "*";
        const color = LGraphCanvas.link_type_colors[displayType];
        for (const node of updateNodes) {
            node.outputs[0].type = inputType || "*";
            node.__outputType = displayType;
            node.outputs[0].name = (input === null || input === void 0 ? void 0 : input.name) || "";
            node.size = node.computeSize();
            (_f = (_e = node).applyNodeSize) === null || _f === void 0 ? void 0 : _f.call(_e);
            for (const l of node.outputs[0].links || []) {
                const link = app.graph.links[l];
                if (link) {
                    link.color = color;
                }
            }
        }
        if (inputNode && inputNodeOutputSlot != null) {
            const links = inputNode.outputs[inputNodeOutputSlot].links;
            for (const l of links || []) {
                const link = app.graph.links[l];
                if (link) {
                    link.color = color;
                }
            }
        }
        (_g = inputNode === null || inputNode === void 0 ? void 0 : inputNode.onConnectionsChainChange) === null || _g === void 0 ? void 0 : _g.call(inputNode);
        (_h = outputNode === null || outputNode === void 0 ? void 0 : outputNode.onConnectionsChainChange) === null || _h === void 0 ? void 0 : _h.call(outputNode);
        app.graph.setDirtyCanvas(true, true);
    }
    setSize(size) {
        const oldSize = [...this.size];
        const newSize = [...size];
        super.setSize(newSize);
        this.properties["size"] = [...this.size];
        this.stabilizeLayout(oldSize, newSize);
    }
    stabilizeLayout(oldSize, newSize) {
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
                }
                else if (layout[1] === "Top") {
                    layout[0] = "Bottom";
                }
                else {
                    layout[0] = "Top";
                    layout[1] = "Bottom";
                    dir[0] = LiteGraph.UP;
                    dir[1] = LiteGraph.DOWN;
                }
                this.setDirtyCanvas(true, true);
            }
            else if (oldSize[1] > 10 && newSize[1] === 10) {
                dir[0] = LiteGraph.RIGHT;
                dir[1] = LiteGraph.LEFT;
                if (layout[0] === "Right") {
                    layout[1] = "Left";
                }
                else if (layout[1] === "Left") {
                    layout[0] = "Right";
                }
                else {
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
    rotate(degrees) {
        const w = this.size[0];
        const h = this.size[1];
        this.properties["connections_layout"] =
            this.properties["connections_layout"] || this.defaultConnectionsLayout;
        const inputDirIndex = LAYOUT_CLOCKWISE.indexOf(this.properties["connections_layout"][0]);
        const outputDirIndex = LAYOUT_CLOCKWISE.indexOf(this.properties["connections_layout"][1]);
        if (degrees == 90 || degrees === -90) {
            if (degrees === -90) {
                this.properties["connections_layout"][0] =
                    LAYOUT_CLOCKWISE[(((inputDirIndex - 1) % 4) + 4) % 4];
                this.properties["connections_layout"][1] =
                    LAYOUT_CLOCKWISE[(((outputDirIndex - 1) % 4) + 4) % 4];
            }
            else {
                this.properties["connections_layout"][0] =
                    LAYOUT_CLOCKWISE[(((inputDirIndex + 1) % 4) + 4) % 4];
                this.properties["connections_layout"][1] =
                    LAYOUT_CLOCKWISE[(((outputDirIndex + 1) % 4) + 4) % 4];
            }
        }
        else if (degrees === 180) {
            this.properties["connections_layout"][0] =
                LAYOUT_CLOCKWISE[(((inputDirIndex + 2) % 4) + 4) % 4];
            this.properties["connections_layout"][1] =
                LAYOUT_CLOCKWISE[(((outputDirIndex + 2) % 4) + 4) % 4];
        }
        this.setSize([h, w]);
    }
    manuallyHandleMove(event) {
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
    manuallyHandleResize(event) {
        const shortcut = this.shortcuts.resize;
        if (shortcut.state) {
            let diffX = Math.round((event.clientX - shortcut.initialMousePos[0]) / 10) * 10;
            let diffY = Math.round((event.clientY - shortcut.initialMousePos[1]) / 10) * 10;
            diffX *= shortcut.resizeOnSide[0] === LiteGraph.LEFT ? -1 : 1;
            diffY *= shortcut.resizeOnSide[1] === LiteGraph.UP ? -1 : 1;
            const oldSize = [...this.size];
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
    cycleConnection(ioDir) {
        var _a, _b;
        this.properties = this.properties || {};
        const props = this.properties;
        props["connections_layout"] = props["connections_layout"] || ["Left", "Right"];
        const propIdx = ioDir == IoDirection.INPUT ? 0 : 1;
        const oppositeIdx = propIdx ? 0 : 1;
        let currentLayout = props["connections_layout"][propIdx];
        let oppositeLayout = props["connections_layout"][oppositeIdx];
        if (this.size[0] === 10 || this.size[1] === 10) {
            props["connections_dir"] = props["connections_dir"] || [-1, -1];
            let currentDir = props["connections_dir"][propIdx];
            const options = this.size[0] === 10
                ? currentLayout === "Bottom"
                    ? [LiteGraph.DOWN, LiteGraph.RIGHT, LiteGraph.LEFT]
                    : [LiteGraph.UP, LiteGraph.LEFT, LiteGraph.RIGHT]
                : currentLayout === "Right"
                    ? [LiteGraph.RIGHT, LiteGraph.DOWN, LiteGraph.UP]
                    : [LiteGraph.LEFT, LiteGraph.UP, LiteGraph.DOWN];
            let idx = options.indexOf(currentDir);
            let next = (_a = options[idx + 1]) !== null && _a !== void 0 ? _a : options[0];
            this.properties["connections_dir"][propIdx] = next;
            return;
        }
        let next = currentLayout;
        do {
            let idx = LAYOUT_CLOCKWISE.indexOf(next);
            next = (_b = LAYOUT_CLOCKWISE[idx + 1]) !== null && _b !== void 0 ? _b : LAYOUT_CLOCKWISE[0];
        } while (next === oppositeLayout);
        this.properties["connections_layout"][propIdx] = next;
        this.setDirtyCanvas(true, true);
    }
    onMouseMove(event) {
        if (this.shortcuts.move.state) {
            const shortcut = this.shortcuts.move;
            if (shortcut.initialMousePos[0] === -1) {
                shortcut.initialMousePos[0] = event.clientX;
                shortcut.initialMousePos[1] = event.clientY;
                shortcut.initialNodePos[0] = this.pos[0];
                shortcut.initialNodePos[1] = this.pos[1];
            }
            this.manuallyHandleMove(event);
        }
        else if (this.shortcuts.resize.state) {
            const shortcut = this.shortcuts.resize;
            if (shortcut.initialMousePos[0] === -1) {
                shortcut.initialMousePos[0] = event.clientX;
                shortcut.initialMousePos[1] = event.clientY;
                shortcut.initialNodeSize[0] = this.size[0];
                shortcut.initialNodeSize[1] = this.size[1];
                shortcut.initialNodePos[0] = this.pos[0];
                shortcut.initialNodePos[1] = this.pos[1];
                const canvas = app.canvas;
                const offset = canvas.convertEventToCanvasOffset(event);
                shortcut.resizeOnSide[0] = this.pos[0] > offset[0] ? LiteGraph.LEFT : LiteGraph.RIGHT;
                shortcut.resizeOnSide[1] = this.pos[1] > offset[1] ? LiteGraph.UP : LiteGraph.DOWN;
            }
            this.manuallyHandleResize(event);
        }
    }
    onKeyDown(event) {
        super.onKeyDown(event);
        const canvas = app.canvas;
        if (CONFIG_FAST_REROUTE_ENABLED) {
            for (const [key, shortcut] of Object.entries(this.shortcuts)) {
                if (!shortcut.state) {
                    const keys = rgthree.areAllKeysDown(shortcut.keys.split("+"));
                    if (keys) {
                        shortcut.state = true;
                        if (key === "rotate") {
                            this.rotate(90);
                        }
                        else if (key.includes("connection")) {
                            this.cycleConnection(key.includes("input") ? IoDirection.INPUT : IoDirection.OUTPUT);
                        }
                        if (shortcut.initialMousePos) {
                            canvas.node_capturing_input = this;
                        }
                    }
                }
            }
        }
    }
    onKeyUp(event) {
        super.onKeyUp(event);
        const canvas = app.canvas;
        if (CONFIG_FAST_REROUTE_ENABLED) {
            for (const [key, shortcut] of Object.entries(this.shortcuts)) {
                if (shortcut.state) {
                    const keys = rgthree.areAllKeysDown(shortcut.keys.split("+"));
                    if (!keys) {
                        shortcut.state = false;
                        if (shortcut.initialMousePos) {
                            shortcut.initialMousePos = [-1, -1];
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
    onDeselected() {
        var _a;
        (_a = super.onDeselected) === null || _a === void 0 ? void 0 : _a.call(this);
        const canvas = app.canvas;
        for (const [key, shortcut] of Object.entries(this.shortcuts)) {
            shortcut.state = false;
            if (shortcut.initialMousePos) {
                shortcut.initialMousePos = [-1, -1];
                if ((canvas.node_capturing_input = this)) {
                    canvas.node_capturing_input = null;
                }
                this.setDirtyCanvas(true, true);
            }
        }
    }
    onRemoved() {
        var _a;
        (_a = super.onRemoved) === null || _a === void 0 ? void 0 : _a.call(this);
        setTimeout(() => {
            SERVICE.handleRemovedNodeMaybeWhileDragging(this);
        }, 32);
    }
    getHelp() {
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
        To change, ${!CONFIG_FAST_REROUTE_ENABLED ? 'enable' : 'disable'} or configure sohrtcuts,
        make a copy of
        <code>/custom_nodes/rgthree-comfy/rgthree_config.json.default</code> to
        <code>/custom_nodes/rgthree-comfy/rgthree_config.json</code> and configure under
        <code>nodes > reroute > fast_reroute</code>.
      </small></p>
    `;
    }
}
RerouteNode.title = "Reroute (rgthree)";
RerouteNode.title_mode = LiteGraph.NO_TITLE;
RerouteNode.collapsable = false;
RerouteNode.layout_slot_offset = 5;
RerouteNode.size = configDefaultSize;
addMenuItem(RerouteNode, app, {
    name: (node) => { var _a; return `${((_a = node.properties) === null || _a === void 0 ? void 0 : _a["showLabel"]) ? "Hide" : "Show"} Label/Title`; },
    property: "showLabel",
    callback: async (node, value) => {
        app.graph.setDirtyCanvas(true, true);
    },
});
addMenuItem(RerouteNode, app, {
    name: (node) => `${node.resizable ? "No" : "Allow"} Resizing`,
    callback: (node) => {
        node.setResizable(!node.resizable);
        node.size[0] = Math.max(40, node.size[0]);
        node.size[1] = Math.max(30, node.size[1]);
        node.applyNodeSize();
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
        node.setResizable(false);
        node.applyNodeSize();
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
        node.setResizable(false);
        node.applyNodeSize();
    },
});
addConnectionLayoutSupport(RerouteNode, app, [
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
], (node) => {
    node.applyNodeSize();
});
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
    callback: (node_, value) => {
        const node = node_;
        if (value === null || value === void 0 ? void 0 : value.startsWith("Rotate 90° Clockwise")) {
            node.rotate(90);
        }
        else if (value === null || value === void 0 ? void 0 : value.startsWith("Rotate 90° Counter-Clockwise")) {
            node.rotate(-90);
        }
        else if (value === null || value === void 0 ? void 0 : value.startsWith("Rotate 180°")) {
            node.rotate(180);
        }
        else {
            const inputDirIndex = LAYOUT_CLOCKWISE.indexOf(node.properties["connections_layout"][0]);
            const outputDirIndex = LAYOUT_CLOCKWISE.indexOf(node.properties["connections_layout"][1]);
            if (value === null || value === void 0 ? void 0 : value.startsWith("Flip Horizontally")) {
                if (["Left", "Right"].includes(node.properties["connections_layout"][0])) {
                    node.properties["connections_layout"][0] =
                        LAYOUT_CLOCKWISE[(((inputDirIndex + 2) % 4) + 4) % 4];
                }
                if (["Left", "Right"].includes(node.properties["connections_layout"][1])) {
                    node.properties["connections_layout"][1] =
                        LAYOUT_CLOCKWISE[(((outputDirIndex + 2) % 4) + 4) % 4];
                }
            }
            else if (value === null || value === void 0 ? void 0 : value.startsWith("Flip Vertically")) {
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
            clone.pos = [pos[0] - 20, pos[1] - 20];
            app.graph.add(clone);
            await wait();
            const inputLinks = getSlotLinks(node.inputs[0]);
            for (const inputLink of inputLinks) {
                const link = inputLink.link;
                const linkedNode = app.graph.getNodeById(link.origin_id);
                if (linkedNode) {
                    linkedNode.connect(0, clone, 0);
                }
            }
            clone.connect(0, node, 0);
        }
        else {
            clone.pos = [pos[0] + 20, pos[1] + 20];
            app.graph.add(clone);
            await wait();
            const outputLinks = getSlotLinks(node.outputs[0]);
            node.connect(0, clone, 0);
            for (const outputLink of outputLinks) {
                const link = outputLink.link;
                const linkedNode = app.graph.getNodeById(link.target_id);
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
