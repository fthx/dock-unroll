/*
    Dock Unroll
    GNOME Shell 46+ extension
    Copyright @fthx 2024
    License GPL v3
*/

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/overview.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const HOT_EDGE_PRESSURE_TIMEOUT = 1000; // ms
const PRESSURE_TRESHOLD = 150;
const EDGE_SIZE = 100; // %
const AUTO_HIDE_DELAY = ANIMATION_TIME * 4; // ms
const HIDDEN_PANEL_HEIGHT = 0.01; // px (> 0 !)
const PANEL_HEIGHT = Main.panel.height;
const PANEL_OPACITY = Main.panel.opacity;
const UNLOCKED_BUTTON_OPACITY = 128; // 0...255


const PanelLockButton = GObject.registerClass(
class PanelLockButton extends PanelMenu.Button {
    _init() {
        super._init();

        this._box = new St.BoxLayout({reactive: true, style_class: 'panel-button'});
        this._icon = new St.Icon({icon_name: 'focus-top-bar-symbolic', style_class: 'system-status-icon'});

        this._box.add_child(this._icon);
        this.add_child(this._box);

        this._panelIsLocked = false;
        this.opacity = UNLOCKED_BUTTON_OPACITY;

        this.connectObject(
            'button-press-event', this._onClicked.bind(this),
            'destroy', this._destroy.bind(this),
            this);
    }

    _onClicked() {
        if (this._panelIsLocked) {
            this._panelIsLocked = false;
            this.opacity = UNLOCKED_BUTTON_OPACITY;
        } else {
            this._panelIsLocked = true;
            this.opacity = 255;
        }
    }

    _destroy() {
        this._panelIsLocked = null;
        this.disconnectObject(this);

        super.destroy();
    }
});

const BottomEdge = GObject.registerClass(
class BottomEdge extends Clutter.Actor {
    _init(monitor, x, y) {
        super._init();

        this._monitor = monitor;
        this._x = x;
        this._y = y;

        this._edgeSize = EDGE_SIZE / 100;
        this._pressureThreshold = PRESSURE_TRESHOLD;

        this._pressureBarrier = new Layout.PressureBarrier(this._pressureThreshold,
                                                            HOT_EDGE_PRESSURE_TIMEOUT,
                                                            Shell.ActionMode.NORMAL |
                                                            Shell.ActionMode.OVERVIEW);

        this._pressureBarrier.connectObject('trigger', this._toggleOverview.bind(this), this);
        this.connectObject('destroy', this._destroy.bind(this), this);
    }

    setBarrierSize(size) {
        if (this._barrier) {
            this._pressureBarrier.removeBarrier(this._barrier);
            this._barrier.destroy();
            this._barrier = null;
        }

        if (size > 0) {
            size = this._monitor.width * this._edgeSize;
            let x_offset = (this._monitor.width - size) / 2;
            this._barrier = new Meta.Barrier({
                backend: global.backend,
                x1: this._x + x_offset, x2: this._x + x_offset + size,
                y1: this._y, y2: this._y,
                directions: Meta.BarrierDirection.NEGATIVE_Y});
            this._pressureBarrier.addBarrier(this._barrier);
        }
    }

    _toggleOverview() {
        if (Main.overview.shouldToggleByCornerOrButton()
                && !(global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK)
                && !this._monitor.inFullscreen) {
            Main.overview.toggle();
        }
    }

    _destroy() {
        this.setBarrierSize(0);

        this._pressureBarrier.destroy();
        this._pressureBarrier = null;

        super.destroy();
    }
});

const TopEdge = GObject.registerClass(
class TopEdge extends Clutter.Actor {
    _init(monitor, x, y) {
        super._init();

        this._monitor = monitor;
        this._x = x;
        this._y = y;

        this._edgeSize = EDGE_SIZE / 100;
        this._pressureThreshold = PRESSURE_TRESHOLD;

        this._pressureBarrier = new Layout.PressureBarrier(this._pressureThreshold,
                                                            HOT_EDGE_PRESSURE_TIMEOUT,
                                                            Shell.ActionMode.NORMAL |
                                                            Shell.ActionMode.OVERVIEW);

        this._pressureBarrier.connectObject('trigger', this._togglePanel.bind(this), this);
        this.connectObject('destroy', this._destroy.bind(this), this);
    }

    setBarrierSize(size) {
        if (this._barrier) {
            this._pressureBarrier.removeBarrier(this._barrier);
            this._barrier.destroy();
            this._barrier = null;
        }

        if (size > 0) {
            size = this._monitor.width * this._edgeSize;
            let x_offset = (this._monitor.width - size) / 2;
            this._barrier = new Meta.Barrier({
                backend: global.backend,
                x1: this._x + x_offset, x2: this._x + x_offset + size,
                y1: this._y, y2: this._y,
                directions: Meta.BarrierDirection.POSITIVE_Y});
            this._pressureBarrier.addBarrier(this._barrier);
        }
    }

    _showPanel() {
        Main.panel.opacity = PANEL_OPACITY;

        Main.panel.ease({
            duration: ANIMATION_TIME,
            height: PANEL_HEIGHT,
            onComplete: () => {
                Main.layoutManager._updateHotCorners();
            },
        });
    }

    _hidePanel() {
        Main.panel.ease({
            duration: ANIMATION_TIME,
            height: HIDDEN_PANEL_HEIGHT,
            onComplete: () => {
                Main.panel.opacity = 0;
                Main.layoutManager._updateHotCorners();
            },
        });
    }

    _togglePanel() {
        if (Main.overview.shouldToggleByCornerOrButton()
                && !Main.overview.visible
                && !(global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK)
                && !this._monitor.inFullscreen) {
            if (Main.panel.height <= HIDDEN_PANEL_HEIGHT) {
                this._showPanel();
            } else {
                this._hidePanel();
            }
        }
    }

    _destroy() {
        this.setBarrierSize(0);

        this._pressureBarrier.disconnectObject(this);
        this._pressureBarrier.destroy();
        this._pressureBarrier = null;

        super.destroy();
    }
});

export default class DockUnrollExtension {
    _updateHotEdges() {
        Main.layoutManager._destroyHotCorners();

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            let monitor = Main.layoutManager.monitors[i];
            let leftX = monitor.x;
            let rightX = monitor.x + monitor.width;
            let bottomY = monitor.y + monitor.height;
            let topY = monitor.y;
            let size = monitor.width;

            let hasBottom = true;
            let hasTop = true;

            for (let j = 0; j < Main.layoutManager.monitors.length; j++) {
                if (j != i) {
                    let otherMonitor = Main.layoutManager.monitors[j];
                    let otherLeftX = otherMonitor.x;
                    let otherRightX = otherMonitor.x + otherMonitor.width;
                    let otherBottomY = otherMonitor.y + otherMonitor.height;
                    let otherTopY = otherMonitor.y;

                    if (otherTopY >= bottomY && otherLeftX < rightX && otherRightX > leftX) {
                        hasBottom = false;
                    }

                    if (otherBottomY <= topY && otherLeftX < rightX && otherRightX > leftX) {
                        hasTop = false;
                    }
                }
            }

            if (hasBottom) {
                let edge = new BottomEdge(monitor, leftX, bottomY);
                edge.setBarrierSize(size);
                Main.layoutManager.hotCorners.push(edge);
            } else {
                Main.layoutManager.hotCorners.push(null);
            }

            if (hasTop) {
                let edge = new TopEdge(monitor, leftX, topY);
                edge.setBarrierSize(size);
                Main.layoutManager.hotCorners.push(edge);
            } else {
                Main.layoutManager.hotCorners.push(null);
            }
        }
    }

    _hidePanel() {
        Main.panel.ease({
            duration: ANIMATION_TIME,
            height: HIDDEN_PANEL_HEIGHT,
            onComplete: () => {
                Main.panel.opacity = 0;
                Main.layoutManager._updateHotCorners();
            },
        });
    }

    _onPanelHover() {
        if (!this._lockButton._panelIsLocked && !Main.panel.get_hover()) {
            this._panelHideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_HIDE_DELAY, () => {
                if (!Main.panel.get_hover()) {
                    this._hidePanel();
                    this._panelHideTimeout = 0;
                }
            });
        }
    }

    enable() {
        Main.layoutManager.connectObject('hot-corners-changed', this._updateHotEdges.bind(this), this);
        this._updateHotEdges();

        this._lockButton = new PanelLockButton();
        Main.panel.addToStatusArea('Panel lock', this._lockButton);

        Main.panel.set_track_hover(true);
        Main.panel.connectObject('notify::hover', this._onPanelHover.bind(this), this);

        this._hidePanel();
    }

    disable() {
        this._lockButton.destroy();
        this._lockButton = null;

        Main.layoutManager.disconnectObject(this);
        Main.layoutManager._updateHotCorners();

        Main.panel.disconnectObject(this);
        if (this._panelHideTimeout) {
            GLib.source_remove(this._panelHideTimeout);
            this._panelHideTimeout = null;
        }

        Main.panel.height = PANEL_HEIGHT;
        Main.panel.opacity = PANEL_OPACITY;
        Main.panel.set_track_hover(false);
    }
}
