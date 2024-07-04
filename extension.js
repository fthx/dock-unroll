/*
    Dock Unroll
    GNOME Shell 46+ extension
    Copyright @fthx 2024
    License GPL v3
*/

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/overview.js';

const HOT_EDGE_PRESSURE_TIMEOUT = 1000; // ms
const PRESSURE_TRESHOLD = 150;
const EDGE_SIZE = 100; // %
const UNLOCKED_BUTTON_OPACITY = 128;


const PanelLockButton = GObject.registerClass(
class PanelLockButton extends PanelMenu.Button {
    _init() {
        super._init();

        this._box = new St.BoxLayout({reactive: true, style_class: 'panel-button'});
        this._icon = new St.Icon({icon_name: 'focus-top-bar-symbolic', style_class: 'system-status-icon'});

        this._box.add_child(this._icon);
        this.add_child(this._box);

        this.opacity = UNLOCKED_BUTTON_OPACITY;
    }
});

const BottomOverview = GObject.registerClass(
class BottomOverview extends Clutter.Actor {
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

export default class DockUnrollExtension {
    _showPanel() {
        if (this._panelIsLocked) {
            return;
        }

        Main.panel.height = this._panelHeight;

        Main.panel.ease({
            duration: ANIMATION_TIME,
            opacity: this._panelOpacity,
        });
    }

    _hidePanel() {
        if (this._panelIsLocked) {
            return;
        }

        Main.panel.height = 0.01;
        Main.panel.opacity = 0;
    }

    _updateHotEdges() {
        Main.layoutManager._destroyHotCorners();

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            let monitor = Main.layoutManager.monitors[i];
            let leftX = monitor.x;
            let rightX = monitor.x + monitor.width;
            let bottomY = monitor.y + monitor.height;
            let size = monitor.width;

            let haveBottom = true;
            for (let j = 0; j < Main.layoutManager.monitors.length; j++) {
                if (j != i) {
                    let otherMonitor = Main.layoutManager.monitors[j];
                    let otherLeftX = otherMonitor.x;
                    let otherRightX = otherMonitor.x + otherMonitor.width;
                    let otherTopY = otherMonitor.y;
                    if (otherTopY >= bottomY && otherLeftX < rightX && otherRightX > leftX) {
                        haveBottom = false;
                    }
                }
            }

            if (haveBottom) {
                let edge = new BottomOverview(monitor, leftX, bottomY);
                edge.setBarrierSize(size);
                Main.layoutManager.hotCorners.push(edge);
            } else {
                Main.layoutManager.hotCorners.push(null);
            }
        }
    }

    _on_button_clicked() {
        if (this._panelIsLocked) {
            this._panelIsLocked = false;
            this._lockButton.opacity = UNLOCKED_BUTTON_OPACITY;

            if (!Main.overview.visible) {
                Main.panel.ease({
                    duration: ANIMATION_TIME,
                    height: 0.01,
                    onComplete: () => {
                        Main.panel.opacity = 0;
                    },
                });
            }
        } else {
            this._panelIsLocked = true;
            this._lockButton.opacity = 255;
        }
    }

    enable() {
        Main.layoutManager.connectObject('hot-corners-changed', this._updateHotEdges.bind(this), this);
        this._updateHotEdges();

        this._panelHeight = Main.panel.height;
        this._panelOpacity = Main.panel.opacity;

        this._hidePanel();

        Main.overview.connectObject(
            'showing', this._showPanel.bind(this),
            'hiding', this._hidePanel.bind(this),
            this);

        this._panelIsLocked = false;
        this._lockButton = new PanelLockButton();
        Main.panel.addToStatusArea('Panel lock', this._lockButton);

        this._lockButton.connectObject('button-press-event', this._on_button_clicked.bind(this), this);
    }

    disable() {
        this._lockButton.disconnectObject(this);

        this._lockButton.destroy();
        this._lockButton = null;
        this._panelIsLocked = null;

        Main.overview.disconnectObject(this);

        this._showPanel();

        this._panelHeight = null;
        this._panelOpacity = null;

        Main.layoutManager.disconnectObject(this);
        Main.layoutManager._updateHotCorners();
    }
}
