'use strict';

var forEach = require('lodash/forEach');
var oo = require('../util/oo');
var warn = require('../util/warn');

function SurfaceManager(documentSession) {
  this.documentSession = documentSession;

  this.surfaces = {};
  this.focusedSurface = null;
  this._stack = [];

  this.fragments = {};

  this.documentSession.on('update', this.onSessionUpdate, this);
  this.documentSession.on('didUpdate', this.onSessionDidUpdate, this);
}

SurfaceManager.Prototype = function() {

  this.dispose = function() {
    this.documentSession.off(this);
  };

  /**
   * Get Surface instance
   *
   * @param {String} name Name under which the surface is registered
   * @return {ui/Surface} The surface instance
   */
  this.getSurface = function(name) {
    if (name) {
      return this.surfaces[name];
    } else {
      warn('Deprecated: Use getFocusedSurface. Always provide a name for getSurface otherwise.');
      return this.getFocusedSurface();
    }
  };

  /**
   * Get the currently focused Surface.
   *
   * @return {ui/Surface} Surface instance
   */
  this.getFocusedSurface = function() {
    return this.focusedSurface;
  };

  /*
   * Push surface state
   */
  this.pushState = function() {
    // TODO: evaluate if this is necessary anymore
    var state = {
      surface: this.focusedSurface,
      selection: null
    };
    if (this.focusedSurface) {
      state.selection = this.focusedSurface.getSelection();
    }
    this.focusedSurface = null;
    this._stack.push(state);
  };

  /**
   * Pop surface state
   */
  this.popState = function() {
    // TODO: evaluate if this is necessary anymore
    var state = this._stack.pop();
    if (state && state.surface) {
      state.surface.setFocused(true);
      state.surface.setSelection(state.selection);
    }
  };

  /**
   * Register a surface
   *
   * @param surface {ui/Surface} A new surface instance to register
   */
  this.registerSurface = function(surface) {
    this.surfaces[surface.getId()] = surface;
  };

  /**
   * Unregister a surface
   *
   * @param surface {ui/Surface} A surface instance to unregister
   */
  this.unregisterSurface = function(surface) {
    surface.off(this);
    delete this.surfaces[surface.getId()];
    // TODO: this should not be necessary anymore
    if (surface && this.focusedSurface === surface) {
      this.focusedSurface = null;
    }
  };


  this.onSessionUpdate = function(update) {
    /*
      TODO
      We will compute fragments for textProperties (selection fragments)
      and highlights for nodes
      then we compute the minimal update for all surfaces and setProps accordingly
    */
    var fragments = {};
    // update old fragments
    forEach(this.fragments, function(_, key) {
      fragments[key] = [];
    });
    // update changed properties
    if (update.change) {
      forEach(update.change.updated, function(key) {
        fragments[key] = [];
      });
    }
    if (update.selection) {
      _getFragmentsForSelection(fragments, update.selection);
    }
    if (update.collaborators) {
      forEach(update.collaborators, function(collaborator) {
        _getFragmentsForSelection(fragments, collaborator.selection);
      });
    }
    forEach(this.surfaces, function(surface) {
      surface.extendProps({
        fragments: fragments
      });
    });

    this.fragments = fragments;
  };

  function _getFragmentsForSelection(fragments, sel) {
    var selFrags = sel.getFragments();
    selFrags.forEach(function(frag) {
      var path = frag.path;
      if (!fragments[path]) {
        fragments[path] = [];
      }
      fragments[path].push(frag);
    });
  }

  this.onSessionDidUpdate = function() {
    /*
      here we will make sure that at the end the DOM selection is rendered
      on the active surface
    */
    // focusedSUrface.rerenderDOMSelection()
    var sel = this.documentSession.getSelection();
    var surfaceId = sel.surfaceId;
    var surface = this.surfaces[surfaceId];
    if (surface) {
      surface.rerenderDOMSelection();
    }
  };

  // this.onSessionDidUpdate = function() {
  //   // console.log('Rerendering DOM selection after document change.', this.__id__);
  //   var sel = this.getSelection();
  //   if (sel.surfaceId === this.getName()) {
  //     if (inBrowser &&
  //         // HACK: in our examples we are hosting two instances of one editor
  //         // which reside in IFrames. To avoid competing DOM selection updates
  //         // we update only the one which as a focused document.
  //         (!Surface.MULTIPLE_APPS_ON_PAGE || window.document.hasFocus())) {
  //       // HACK: under FF we must make sure that the contenteditable is
  //       // focused.
  //       if (!this._internalState.hasNativeFocus) {
  //         this.skipNextFocusEvent = true;
  //         this.el.focus();
  //       }
  //       this.rerenderDomSelection();
  //     }
  //   }
  // };

};

oo.initClass(SurfaceManager);

module.exports = SurfaceManager;
