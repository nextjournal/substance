'use strict';

var each = require('lodash/each');
var extend = require('lodash/extend');
var error = require('../util/error');
var info = require('../util/info');
var inBrowser = require('../util/inBrowser');
var keys = require('../util/keys');
var platform = require('../util/platform');
var warn = require('../util/warn');
var Registry = require('../util/Registry');
var copySelection = require('../model/transform/copySelection');
var deleteSelection = require('../model/transform/deleteSelection');
var insertText = require('../model/transform/insertText');
var Clipboard = require('./Clipboard');
var Component = require('./Component');
var DefaultDOMElement = require('./DefaultDOMElement');
var DOMSelection = require('./DOMSelection');
var UnsupportedNode = require('./UnsupportedNodeComponent');

/**
   Abstract interface for editing components.
   Dances with contenteditable, so you don't have to.

   @class
   @component
   @abstract
*/
function Surface() {
  Surface.super.apply(this, arguments);

  // DocumentSession instance must be provided either as a prop
  // or via dependency-injection
  this.documentSession = this.props.documentSession || this.context.documentSession;
  if (!this.documentSession) {
    throw new Error('No DocumentSession provided');
  }
  this.name = this.props.name;
  if (!this.name) {
    throw new Error('Surface must have a name.');
  }
  if (this.name.indexOf('/') > -1) {
    // because we are using '/' to deal with nested surfaces (isolated nodes)
    throw new Error("Surance.name must not contain '/'");
  }
  // this path is an identifier unique for this surface
  // considering nesting in IsolatedNodes
  this._surfaceId = _createSurfaceId(this);

  this.clipboard = new Clipboard(this);

  this.domSelection = null;

  this.onDomMutations = this.onDomMutations.bind(this);
  this.domObserver = new window.MutationObserver(this.onDomMutations);
  this.domObserverConfig = { subtree: true, characterData: true };
  this.skipNextObservation = false;

  // HACK: we need to listen to mousup on document
  // to catch events outside the surface
  if (inBrowser) {
    this.documentEl = DefaultDOMElement.wrapNativeElement(window.document);
  }

  // set when editing is enabled
  this.undoEnabled = true;
  this.textTypes = this.props.textTypes;
  this.commandRegistry = _createCommandRegistry(this, this.props.commands);

  // a registry for TextProperties which allows us to dispatch changes
  this._textProperties = {};

  this._state = {
    // true if the document session's selection is addressing this surface
    hasNativeFocus: false,
    skipNextFocusEvent: false,
    // used to avoid multiple rerenderings (e.g. simultanous update of text and fragments)
    isDirty: false,
    dirtyProperties: {},
    // while fragments are provided as a hash of (type -> [Fragment])
    // we derive a hash of (prop-key -> [Fragment]); in other words, Fragments grouped by property
    fragments: {},
    // we want to show the cursor fragment only when blurred, so we keep it separated from the other fragments
    cursorFragment: null,
  };

  this._deriveProps(this.props);
}

function _createCommandRegistry(surface, commands) {
  var commandRegistry = new Registry();
  each(commands, function(CommandClass) {
    var commandContext = extend({}, surface.context, surface.getChildContext());
    var cmd = new CommandClass(commandContext);
    commandRegistry.add(CommandClass.static.name, cmd);
  });
  return commandRegistry;
}

function _createSurfaceId(surface) {
  var surfaceParent = surface.getSurfaceParent();
  if (surfaceParent) {
    return surfaceParent.getId() + '/' + surface.name;
  } else {
    return surface.name;
  }
}

Surface.Prototype = function() {

  var _super = Surface.super.prototype;

  this.getChildContext = function() {
    return {
      surface: this,
      surfaceParent: this,
      doc: this.getDocument()
    };
  };

  this.didMount = function() {
    _super.didMount.call(this);

    if (this.context.surfaceManager) {
      this.context.surfaceManager.registerSurface(this);
    }
    if (!this.isReadonly()) {
      this.domSelection = this._createDOMSelection();
      this.clipboard.didMount();
      // Document Change Events
      this.domObserver.observe(this.el.getNativeElement(), this.domObserverConfig);
    }
  };

  this.dispose = function() {
    _super.dispose.call(this);

    this.domSelection = null;
    this.domObserver.disconnect();
    if (this.context.surfaceManager) {
      this.context.surfaceManager.unregisterSurface(this);
    }
  };

  this.willReceiveProps = function(nextProps) {
    _super.willReceiveProps.apply(this, arguments);

    this._deriveProps(nextProps);
  };

  this.didUpdate = function() {
    _super.didUpdate.call(this);

    this._update();
  };

  this.render = function($$) {
    var tagName = this.props.tagName || 'div';
    var el = $$(tagName)
      .addClass('sc-surface')
      .attr('spellCheck', false)
      .attr('tabindex', 2)
      .attr('contenteditable', false);

    if (!this.isDisabled()) {
      if (this.isEditable()) {
        // Keyboard Events
        el.on('keydown', this.onKeyDown);
        // OSX specific handling of dead-keys
        if (!platform.isIE) {
          el.on('compositionstart', this.onCompositionStart);
        }
        // Note: TextEvent in Chrome/Webkit is the easiest for us
        // as it contains the actual inserted string.
        // Though, it is not available in FF and not working properly in IE
        // where we fall back to a ContentEditable backed implementation.
        if (window.TextEvent && !platform.isIE) {
          el.on('textInput', this.onTextInput);
        } else {
          el.on('keypress', this.onTextInputShim);
        }
      }
      if (!this.isReadonly()) {
        // Mouse Events
        el.on('mousedown', this.onMouseDown);
        // disable drag'n'drop
        el.on('dragstart', this.onDragStart);
        // we will react on this to render a custom selection
        el.on('focus', this.onNativeFocus);
        el.on('blur', this.onNativeBlur);
        // activate the clipboard
        this.clipboard.attach(el);
      }
    }
    return el;
  };

  this.renderNode = function($$, node) {
    var doc = this.getDocument();
    var componentRegistry = this.getComponentRegistry();
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      error('Could not resolve a component for type: ' + node.type);
      ComponentClass = UnsupportedNode;
    }
    return $$(ComponentClass, {
      doc: doc,
      node: node
    }).ref(node.id);
  };

  this.getComponentRegistry = function() {
    return this.context.componentRegistry || this.props.componentRegistry;
  };

  this.getName = function() {
    return this.name;
  };

  this.getId = function() {
    return this._surfaceId;
  };

  this.isDisabled = function() {
    return this.props.disabled;
  };

  this.isEditable = function() {
    return (this.props.editing === "full" ||  this.props.editing === undefined);
  };

  this.isSelectable = function() {
    return (this.props.editing === "selection" ||  this.props.editing === "full");
  };

  this.isReadonly = function() {
    return this.props.editing === "readonly";
  };

  this.getCommand = function(commandName) {
    return this.commandRegistry.get(commandName);
  };

  this.executeCommand = function(commandName, args) {
    var cmd = this.getCommand(commandName);
    if (!cmd) {
      warn('command', commandName, 'not registered on controller');
      return;
    }
    // Run command
    var info = cmd.execute(args);
    if (info) {
      this.emit('command:executed', info, commandName, cmd);
      // TODO: We want to replace this with a more specific, scoped event
      // but for that we need an improved EventEmitter API
    } else if (info === undefined) {
      warn('command ', commandName, 'must return either an info object or true when handled or false when not handled');
    }
  };

  this.getElement = function() {
    return this.el;
  };

  this.getController = function() {
    return this.context.controller;
  };

  this.getDocument = function() {
    return this.documentSession.getDocument();
  };

  this.getDocumentSession = function() {
    return this.documentSession;
  };

  this.isEnabled = function() {
    return !this.state.disabled;
  };

  this.isContainerEditor = function() {
    return false;
  };


  /**
    Run a transformation as a transaction properly configured for this surface.

    @param transformation a transformation function(tx, args) which receives
                          the selection the transaction was started with, and should return
                          output arguments containing a selection, as well.

    @example

    Returning a new selection:
    ```js
    surface.transaction(function(tx, args) {
      var selection = args.selection;
      ...
      selection = tx.createSelection(...);
      return {
        selection: selection
      };
    });
    ```

    Adding event information to the transaction:

    ```js
    surface.transaction(function(tx, args) {
      tx.info.foo = 'bar';
      ...
    });
    ```
   */
  this.transaction = function(transformation) {
    var documentSession = this.documentSession;
    var surfaceId = this.getId();
    var self = this;
    documentSession.transaction(function(tx, args) {
      // `beforeState` is saved with the document operation and will be used
      // to recover the selection when using 'undo'.
      tx.before.surfaceId = surfaceId;
      self._prepareArgs(args);
      return transformation(tx, args);
    });
  };

  this.setFocused = function() {
    warn('DEPRECATED: this is should not be necessary anymore.\n'+
         'Maybe you want the native focus? then you can try surface.focus()');
  };

  this.getSelection = function() {
    return this.documentSession.getSelection();
  };

  /*
    Internal method to access the surface parent.
  */
  this.getSurfaceParent = function() {
    return this.context.surfaceParent;
  };

  /**
   * Set the model selection and update the DOM selection accordingly
   */
  this.setSelection = function(sel) {
    // console.log('Surface.setSelection()', this.name, sel);
    // storing the surface id so that we can associate
    // the selection with this surface later
    if (sel && !sel.isNull()) {
      sel.surfaceId = this.getId();
    }
    this._setSelection(sel);
  };

  this.blur = function() {
    if (this._state.hasNativeFocus) {
      this.el.blur();
    } else {
      this._update();
      this.rerenderDOMSelection();
    }
    this.emit('surface:blurred', this);
  };

  this.focus = function() {
    if (!this._state.hasNativeFocus) {
      this.el.focus();
    }
    this._update();
    this.rerenderDOMSelection();
    this.emit('surface:focused', this);
  };

  this.setSelectionFromEvent = function(evt) {
    if (this.domSelection) {
      this._state.skipNextFocusEvent = true;
      var domRange = Surface.getDOMRangeFromEvent(evt);
      var range = this.domSelection.getSelectionFromDOMRange(domRange);
      var sel = this.getDocument().createSelection(range);
      this.setSelection(sel);
    }
  };

  this.rerenderDOMSelection = function() {
    if (inBrowser &&
      // HACK: in our examples we are hosting two instances of one editor
      // which reside in IFrames. To avoid competing DOM selection updates
      // we update only the one which as a focused document.
      (!Surface.MULTIPLE_APPS_ON_PAGE || window.document.hasFocus())) {
      // console.log('Surface.rerenderDOMSelection', this.__id__);
      if (!this._state.hasNativeFocus) {
        this.skipNextFocusEvent = true;
        this.el.focus();
      }
      var sel = this.getSelection();
      this.domSelection.setSelection(sel);
    }
  };

  this.getDomNodeForId = function(nodeId) {
    return this.el.getNativeElement().querySelector('*[data-id="'+nodeId+'"]');
  };

  /* Editing behavior */

  /* Note: In a regular Surface all text properties are treated independently
     like in a form */

  /**
    Selects all text
  */
  this.selectAll = function() {
    var doc = this.getDocument();
    var sel = this.getSelection();
    if (sel.isPropertySelection()) {
      var path = sel.path;
      var text = doc.get(path);
      sel = doc.createSelection({
        type: 'property',
        path: path,
        startOffset: 0,
        endOffset: text.length
      });
      this.setSelection(sel);
    }
  };

  /**
    Performs an {@link model/transform/insertText} transformation
  */
  this.insertText = function(tx, args) {
    var sel = args.selection;
    if (sel.isPropertySelection() || sel.isContainerSelection()) {
      return insertText(tx, args);
    }
  };

  /**
    Performs a {@link model/transform/deleteSelection} transformation
  */
  this.delete = function(tx, args) {
    return deleteSelection(tx, args);
  };

  // No breaking in properties, insert softbreak instead
  this.break = function(tx, args) {
    return this.softBreak(tx, args);
  };

  /**
    Inserts a soft break
  */
  this.softBreak = function(tx, args) {
    args.text = "\n";
    return this.insertText(tx, args);
  };

  /**
    Copy the current selection. Performs a {@link model/transform/copySelection}
    transformation.
  */
  this.copy = function(doc, selection) {
    var result = copySelection(doc, { selection: selection });
    return result.doc;
  };

  /**
    Performs a {@link model/transform/paste} transformation
  */
  this.paste = function(tx, args) {
    // TODO: for now only plain text is inserted
    // We could do some stitching however, preserving the annotations
    // received in the document
    if (args.text) {
      return this.insertText(tx, args);
    }
  };

  /* Event handlers */

  /*
   * Handle document key down events.
   */
  this.onKeyDown = function(event) {
    if ( event.which === 229 ) {
      // ignore fake IME events (emitted in IE and Chromium)
      return;
    }
    switch ( event.keyCode ) {
      case keys.LEFT:
      case keys.RIGHT:
        return this._handleLeftOrRightArrowKey(event);
      case keys.UP:
      case keys.DOWN:
        return this._handleUpOrDownArrowKey(event);
      case keys.ENTER:
        return this._handleEnterKey(event);
      case keys.SPACE:
        return this._handleSpaceKey(event);
      case keys.BACKSPACE:
      case keys.DELETE:
        return this._handleDeleteKey(event);
      default:
        break;
    }

    // Note: when adding a new handler you might want to enable this log to see keyCodes etc.
    // console.log('####', event.keyCode, event.metaKey, event.ctrlKey, event.shiftKey);

    // Built-in key combos
    // Ctrl+A: select all
    var handled = false;
    if ( (event.ctrlKey||event.metaKey) && event.keyCode === 65) {
      this.selectAll();
      handled = true;
    }
    // Undo/Redo: cmd+z, cmd+shift+z
    else if (this.undoEnabled && event.keyCode === 90 && (event.metaKey||event.ctrlKey)) {
      if (event.shiftKey) {
        this.getController().executeCommand('redo');
      } else {
        this.getController().executeCommand('undo');
      }
      handled = true;
    }
    // Toggle strong: cmd+b ctrl+b
    else if (event.keyCode === 66 && (event.metaKey||event.ctrlKey)) {
      this.executeCommand('strong');
      handled = true;
    }
    // Toggle emphasis: cmd+i ctrl+i
    else if (event.keyCode === 73 && (event.metaKey||event.ctrlKey)) {
      this.executeCommand('emphasis');
      handled = true;
    }
    // Toggle link: cmd+l ctrl+l
    else if (event.keyCode === 76 && (event.metaKey||event.ctrlKey)) {
      this.executeCommand('link');
      handled = true;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  this.onTextInput = function(event) {
    if (!event.data) return;
    // console.log("TextInput:", event);
    event.preventDefault();
    event.stopPropagation();
    // necessary for handling dead keys properly
    this.skipNextObservation=true;
    this.transaction(function(tx, args) {
      if (this.domSelection) {
        // trying to remove the DOM selection to reduce flickering
        this.domSelection.clear();
      }
      args.text = event.data;
      return this.insertText(tx, args);
    }.bind(this));
  };

  // Handling Dead-keys under OSX
  this.onCompositionStart = function() {
    // just tell DOM observer that we have everything under control
    this.skipNextObservation = true;
  };

  this.onTextInputShim = function(event) {
    // Filter out non-character keys
    if (
      // Catches most keys that don't produce output (charCode === 0, thus no character)
      event.which === 0 || event.charCode === 0 ||
      // Opera 12 doesn't always adhere to that convention
      event.keyCode === keys.TAB || event.keyCode === keys.ESCAPE ||
      // prevent combinations with meta keys, but not alt-graph which is represented as ctrl+alt
      !!(event.metaKey) || (!!event.ctrlKey^!!event.altKey)
    ) {
      return;
    }
    var character = String.fromCharCode(event.which);
    this.skipNextObservation=true;
    if (!event.shiftKey) {
      character = character.toLowerCase();
    }
    if (character.length>0) {
      this.transaction(function(tx, args) {
        if (this.domSelection) {
          // trying to remove the DOM selection to reduce flickering
          this.domSelection.clear();
        }
        args.text = character;
        return this.insertText(tx, args);
      }.bind(this));
      event.preventDefault();
      event.stopPropagation();
      return;
    } else {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  this.onMouseDown = function(event) {
    // console.log('mousedown on', this.name);
    event.stopPropagation();

    // special treatment for triple clicks
    if (!(platform.isIE && platform.version<12) && event.detail >= 3) {
      var sel = this.getSelection();
      if (sel.isPropertySelection()) {
        this._selectProperty(sel.path);
        event.preventDefault();
        event.stopPropagation();
        return;
      } else if (sel.isContainerSelection()) {
        this._selectProperty(sel.startPath);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    // TODO: what is this exactly?
    if ( event.which !== 1 ) {
      return;
    }
    // HACK: clearing this, otherwise we have troubles with the old selection in the way for the next selection
    this.domSelection.clear();
    // 'mouseDown' is triggered before 'focus' so we tell
    // our focus handler that we are already dealing with it
    // The opposite situation, when the surface gets focused event.g. using keyboard
    // then the handler needs to kick in and recover a persisted selection or such
    this.skipNextFocusEvent = true;
    setTimeout(function() {
      if (this.domSelection) {
        var sel = this.domSelection.getSelection();
        this.setSelection(sel);
      }
    }.bind(this));

    // Bind mouseup to the whole document in case of dragging out of the surface
    if (this.documentEl) {
      // TODO: we should handle mouse up only if we started a drag (and the selection has really changed)
      this.documentEl.on('mouseup', this.onMouseUp, this, { once: true });
    }
  };

  this.onMouseUp = function() {
    // ATTENTION: this delay is necessary for cases the user clicks
    // into an existing selection. In this case the window selection still
    // holds the old value, and is set to the correct selection after this
    // being called.
    setTimeout(function() {
      if (this.domSelection) {
        var sel = this.domSelection.getSelection();
        this.setSelection(sel);
      }
    }.bind(this));
  };

  this.onDomMutations = function() {
    if (this.skipNextObservation) {
      this.skipNextObservation = false;
      return;
    }
    // Known use-cases:
    //  - Context-menu:
    //      - Delete
    //      - Note: copy, cut, paste work just fine
    //  - dragging selected text
    //  - spell correction
    info("We want to enable a DOM MutationObserver which catches all changes made by native interfaces (such as spell corrections, etc). Lookout for this message and try to set Surface.skipNextObservation=true when you know that you will mutate the DOM.");
  };

  this.onDragStart = function(event) {
    event.preventDefault();
    event.stopPropagation();
  };

  this.onNativeBlur = function() {
    // console.log('Native blur on surface', this.getId());
    var _state = this._state;
    _state.hasNativeFocus = false;
    if (_state.skipNextFocusEvent) {
      _state.skipNextFocusEvent = false;
      return;
    }
    // native blur does not lead to a session update,
    // thus we need to update the selection manually
    if (_state.cursorFragment) {
      this._updateProperty(_state.cursorFragment.key);
    }
  };

  this.onNativeFocus = function() {
    // console.log('Native focus on surface', this.getId());
    var _state = this._state;
    _state.hasNativeFocus = true;
    // in some cases we don't react on native focusing
    // e.g., when the selection is done via mouse
    // or if the selection is set implicitly
    if (_state.skipNextFocusEvent) {
      _state.skipNextFocusEvent = false;
      return;
    }
    // native blur does not lead to a session update,
    // thus we need to update the selection manually
    if (_state.cursorFragment) {
      this._updateProperty(_state.cursorFragment.key);
    }
  };

  // Internal implementations

  this._deriveProps = function(nextProps) {
    // console.log('deriving props', nextProps, window.clientId);
    var _state = this._state;
    var oldFragments = this.props.fragments;
    if (oldFragments) {
      _forEachFragment(oldFragments, function(frag) {
        var key = frag.path.toString();
        if (this._getComponentForKey(key)) {
          _markAsDirty(_state, key);
        }
      }.bind(this));
    }
    var nextFragments = nextProps.fragments;
    if (nextFragments) {
      this._deriveFragments(nextFragments);
    }
    // console.log('derived props', _state, window.clientId);
  };

  this._deriveFragments = function(newFragments) {
    // console.log('deriving fragments', newFragments, window.clientId);
    var _state = this._state;
    _state.cursorFragment = null;
    // group fragments by property
    var fragments = {};
    _forEachFragment(newFragments, function(frag, owner) {
      var key = frag.path.toString();
      frag.key = key;
      // skip frags which are not rendered here
      if (!this._getComponentForKey(key)) return;
      // extract the cursor fragment for special treatment (not show when focused)
      if (frag.type === 'cursor' && owner === 'local-user') {
        _state.cursorFragment = frag;
        return;
      }
      var propertyFrags = fragments[key];
      if (!propertyFrags) {
        propertyFrags = [];
        fragments[key] = propertyFrags;
      }
      propertyFrags.push(frag);
      _markAsDirty(_state, key);
    }.bind(this));
    _state.fragments = fragments;
    // console.log('derived fragments', fragments, window.clientId);
  };

  function _forEachFragment(fragments, fn) {
    each(fragments, function(frags, owner) {
      frags.forEach(function(frag) {
        fn(frag, owner);
      });
    });
  }

  // called by SurfaceManager to know which text properties need to be
  // updated because of model changes
  this._checkForUpdates = function(change) {
    var _state = this._state;
    Object.keys(change.updated).forEach(function(key) {
      if (this._getComponentForKey(key)) {
        _markAsDirty(_state, key);
      }
    }.bind(this));
    return _state.isDirty;
  };

  this._update = function() {
    var _state = this._state;
    var dirtyProperties = Object.keys(_state.dirtyProperties);
    for (var i = 0; i < dirtyProperties.length; i++) {
      this._updateProperty(dirtyProperties[i]);
    }
    _state.isDirty = false;
    _state.dirtyProperties = {};
  };

  function _markAsDirty(_state, key) {
    _state.isDirty = true;
    _state.dirtyProperties[key] = true;
  }

  this._updateProperty = function(key) {
    var _state = this._state;
    // hide the cursor fragment when focused
    var cursorFragment = _state.hasNativeFocus ? null : _state.cursorFragment;
    var frags = _state.fragments[key] || [];
    if (cursorFragment && cursorFragment.key === key) {
      frags = frags.concat([cursorFragment]);
    }
    var comp = this._getComponentForKey(key);
    if (comp) {
      comp.extendProps({
        fragments: frags
      });
    }
  };

  this._getComponentForKey = function(key) {
    return this._textProperties[key];
  };

  this._handleLeftOrRightArrowKey = function (event) {
    event.stopPropagation();
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      if (!this.isMounted()) return;
      var options = {
        direction: (event.keyCode === keys.LEFT) ? 'left' : 'right'
      };
      this._updateModelSelection(options);
    }.bind(this));
  };

  this._handleUpOrDownArrowKey = function (event) {
    event.stopPropagation();
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      if (!this.isMounted()) return;
      var options = {
        direction: (event.keyCode === keys.UP) ? 'left' : 'right'
      };
      this._updateModelSelection(options);
    }.bind(this));
  };

  this._handleSpaceKey = function(event) {
    event.preventDefault();
    event.stopPropagation();
    this.transaction(function(tx, args) {
      // trying to remove the DOM selection to reduce flickering
      this.domSelection.clear();
      args.text = " ";
      return this.insertText(tx, args);
    }.bind(this));
  };

  this._handleEnterKey = function(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      this.transaction(function(tx, args) {
        return this.softBreak(tx, args);
      }.bind(this));
    } else {
      this.transaction(function(tx, args) {
        return this.break(tx, args);
      }.bind(this));
    }
  };

  this._handleDeleteKey = function (event) {
    event.preventDefault();
    event.stopPropagation();
    var direction = (event.keyCode === keys.BACKSPACE) ? 'left' : 'right';
    this.transaction(function(tx, args) {
      args.direction = direction;
      return this.delete(tx, args);
    }.bind(this));
  };

  this._setSelection = function(sel) {
    var _state = this._state;
    // Since we allow the surface be blurred natively when clicking
    // on tools we now need to make sure that the element is focused natively
    // when we set the selection
    // This is actually only a problem on FF, other browsers set the focus implicitly
    // when a new DOM selection is set.
    // ATTENTION: in FF 44 this was causing troubles, making the CE unselectable
    // until the next native blur.
    if (!sel.isNull() && this.el && !_state.hasNativeFocus) {
      _state.skipNextFocusEvent = true;
      this.el.focus();
    }
    this.documentSession.setSelection(sel);
  };

  this._updateModelSelection = function(options) {
    var sel = this.domSelection.getSelection(options);
    // NOTE: this will also lead to a rerendering of the selection
    // via session.on('update')
    this.setSelection(sel);
  };

  this._selectProperty = function(path) {
    var doc = this.getDocument();
    var text = doc.get(path);
    this.setSelection(doc.createSelection(path, 0, text.length));
  };

  // EXPERIMENTAL: get bounding box for current selection
  this.getBoundingRectangleForSelection = function() {
    var wsel = window.getSelection();
    // having a DOM selection?
    if (wsel.rangeCount > 0) {
      var wrange = wsel.getRangeAt(0);
      // unfortunately, collapsed selections to not have a boundary rectangle
      // thus we need to insert a span temporarily and take its rectangle
      if (wrange.collapsed) {
        var span = document.createElement('span');
        // Ensure span has dimensions and position by
        // adding a zero-width space character
        this.skipNextObservation = true;
        span.appendChild(DefaultDOMElement.createTextNode("\u200b"));
        wrange.insertNode(span);
        var rect = span.getBoundingClientRect();
        var spanParent = span.parentNode;
        spanParent.removeChild(span);
        // Glue any broken text nodes back together
        spanParent.normalize();
        return rect;
      } else {
        return wrange.getBoundingClientRect();
      }
    } else {
      var sel = this.getSelection();
      if (sel.isNull()) {
        return {};
      } else {
        var nativeEl = this.el.getNativeElement();
        if (sel.isCollapsed()) {
          var cursorEl = nativeEl.querySelector('.se-cursor');
          if (cursorEl) {
            return cursorEl.getBoundingClientRect();
          } else {
            error('FIXME: there should be a rendered cursor element.');
            return {};
          }
        } else {
          var selFragments = nativeEl.querySelectorAll('.se-selection-fragment');
          if (selFragments.length > 0) {
            var bottom = 0;
            var top = 0;
            var right = 0;
            var left = 0;
            selFragments.forEach(function(el) {
              var rect = el.getBoundingClientRect();
              bottom = Math.max(rect.bottom, bottom);
              top = Math.min(rect.top, top);
              left = Math.min(rect.left, left);
              right = Math.max(rect.right, right);
            });
            var height = bottom - top;
            var width = right -left;
            return {
              top: top, bottom: bottom,
              left: left, right: right,
              width: width, height: height
            };
          } else {
            error('FIXME: there should be a rendered selection fragments element.');
          }
        }
      }
    }
  };

  // internal API for TextProperties to enable dispatching
  // TextProperty components are registered via path
  // Annotations are just registered via path for lookup, not as instances

  this._registerTextProperty = function(textPropertyComponent) {
    var path = textPropertyComponent.getPath();
    this._textProperties[path] = textPropertyComponent;
  };

  this._unregisterTextProperty = function(textPropertyComponent) {
    var path = textPropertyComponent.getPath();
    if (this._textProperties[path] === textPropertyComponent) {
      delete this._textProperties[path];
    }
  };

  this._getTextPropertyComponent = function(path) {
    return this._textProperties[path];
  };

  this._createDOMSelection = function() {
    return new DOMSelection(this);
  };

  /*
    Called when starting a transaction to populate the transaction
    arguments.

    ATM used only by ContainerEditor.
  */
  this._prepareArgs = function(args) {
    /* jshint unused: false */
  };

};

Component.extend(Surface);

Surface.getDOMRangeFromEvent = function(evt) {
  var range, x = evt.clientX, y = evt.clientY;

  // Try the simple IE way first
  if (document.body.createTextRange) {
    range = document.body.createTextRange();
    range.moveToPoint(x, y);
  }

  else if (typeof document.createRange != "undefined") {
    // Try Mozilla's rangeOffset and rangeParent properties,
    // which are exactly what we want
    if (typeof evt.rangeParent != "undefined") {
      range = document.createRange();
      range.setStart(evt.rangeParent, evt.rangeOffset);
      range.collapse(true);
    }

    // Try the standards-based way next
    else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }

    // Next, the WebKit way
    else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    }
  }

  return range;
};

module.exports = Surface;
