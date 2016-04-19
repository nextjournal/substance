'use strict';

var isEqual = require('lodash/isEqual');
var each = require('lodash/each');
var extend = require('lodash/extend');
var platform = require('../util/platform');
var Registry = require('../util/Registry');
var Selection = require('../model/Selection');
var copySelection = require('../model/transform/copySelection');
var insertText = require('../model/transform/insertText');
var deleteSelection = require('../model/transform/deleteSelection');
var DOMSelection = require('./DOMSelection');
var Clipboard = require('./Clipboard');
var Component = require('./Component');
var UnsupportedNode = require('./UnsupportedNode');
var keys = require('../util/keys');
var inBrowser = require('../util/inBrowser');
var DefaultDOMElement = require('./DefaultDOMElement');

/**
   Abstract interface for editing components.
   Dances with contenteditable, so you don't have to.

   @class
   @component
   @abstract
*/
function Surface() {
  Surface.super.apply(this, arguments);

  this.controller = this.context.controller || this.props.controller;
  if (!this.controller) {
    throw new Error('Surface needs a valid controller');
  }
  this.documentSession = this.controller.getDocumentSession();
  this.name = this.props.name;
  if (!this.name) {
    throw new Error('No id provided');
  }

  this.clipboard = new Clipboard(this);
  var doc = this.documentSession.getDocument();

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
  this.enabled = true;
  this.undoEnabled = true;
  this.textTypes = this.props.textTypes;
  this._initializeCommandRegistry(this.props.commands);

  // true if the document session's selection is addressing this surface
  this.hasNativeFocus = false;

  // a registry for TextProperties which allows us to dispatch changes
  this._textProperties = {};
  this._selectionFragments = null;
  this._cursorFragment = null;
  this._annotations = {};

  doc.on('document:changed', this.onDocumentChange, this);
  this.documentSession.on('collaborators:changed', this.onCollaboratorsChange, this);
}

Surface.Prototype = function() {

  this.render = function($$) {
    var tagName = this.props.tagName || 'div';
    var el = $$(tagName)
      .addClass('sc-surface')
      .attr('spellCheck', false)
      .attr('tabindex', 2)
      .attr('contenteditable', false);

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

    return el;
  };

  this.getComponentRegistry = function() {
    return this.context.componentRegistry || this.props.componentRegistry;
  };

  this.renderNode = function($$, node) {
    var doc = this.getDocument();
    var componentRegistry = this.getComponentRegistry();
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      console.error('Could not resolve a component for type: ' + node.type);
      ComponentClass = UnsupportedNode;
    }
    return $$(ComponentClass, {
      doc: doc,
      node: node
    });
  };

  this.didMount = function() {
    if (this.context.surfaceManager) {
      this.context.surfaceManager.registerSurface(this);
    }
    if (!this.isReadonly()) {
      this.domSelection = this._createDOMSelection();
      this.clipboard.didMount();
      // Document Change Events
      this.domObserver.observe(this.el.getNativeElement(), this.domObserverConfig);
      var sel = this.getSelection();
      if (sel.surfaceId === this.name) {
        this.el.focus();
        this._rerenderSelection();
      }
    }
  };

  this.dispose = function() {
    var doc = this.getDocument();
    doc.off(this);
    this.domSelection = null;
    this.domObserver.disconnect();
    if (this.context.surfaceManager) {
      this.context.surfaceManager.unregisterSurface(this);
    }
  };

  this.getChildContext = function() {
    return {
      surface: this,
      doc: this.getDocument()
    };
  };

  this.getName = function() {
    return this.name;
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
      console.warn('command', commandName, 'not registered on controller');
      return;
    }
    // Run command
    var info = cmd.execute(args);
    if (info) {
      this.emit('command:executed', info, commandName, cmd);
      // TODO: We want to replace this with a more specific, scoped event
      // but for that we need an improved EventEmitter API
    } else if (info === undefined) {
      console.warn('command ', commandName, 'must return either an info object or true when handled or false when not handled');
    }
  };

  this.getElement = function() {
    return this.el;
  };

  this.getController = function() {
    return this.controller;
  };

  this.getDocument = function() {
    return this.documentSession.getDocument();
  };

  this.getDocumentSession = function() {
    return this.documentSession;
  };

  this.enable = function() {
    // As opposed to a ContainerEditor, a regular Surface
    // is not a ContentEditable -- but every contained TextProperty
    console.log('TODO: enable all contained TextProperties');
    this.enabled = true;
  };

  this.disable = function() {
    console.log('TODO: disable all contained TextProperties');
    this.enabled = false;
  };

  this.isEnabled = function() {
    return this.enabled;
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
    var surfaceId = this.getName();
    var self = this;
    // using the silent version, so that the selection:changed event does not get emitted too early
    documentSession.transaction(function(tx, args) {
      // `beforeState` is saved with the document operation and will be used
      // to recover the selection when using 'undo'.
      tx.before.surfaceId = surfaceId;
      self._prepareArgs(args);
      return transformation(tx, args);
    });
  };

  this.setFocused = function() {
    console.log('DEPRECATED: this is should not be necessary anymore.');
    console.log('Maybe you want the native focus? then you can try surface.focus()');
  };

  this.getSelection = function() {
    return this.documentSession.getSelection();
  };

  /**
   * Set the model selection and update the DOM selection accordingly
   */
  this.setSelection = function(sel) {
    console.log('Surface.setSelection()', this.name, sel);
    // storing the surface id so that we can associate
    // the selection with this surface later
    if (sel && !sel.isNull()) {
      sel.surfaceId = this.name;
    }
    this._setSelection(sel);
    // this.emit('selection:changed', sel, this);
  };

  this.blur = function() {
    if (this.hasNativeFocus) {
      this.el.blur();
    } else {
      this._rerenderSelection();
    }
    this.emit('surface:blurred', this);
  };

  this.focus = function() {
    if (!this.hasNativeFocus) {
      this.el.focus();
    }
    this.emit('surface:focused', this);
  };

  this.setSelectionFromEvent = function(evt) {
    if (this.domSelection) {
      this.skipNextFocusEvent = true;
      var domRange = Surface.getDOMRangeFromEvent(evt);
      var range = this.domSelection.getSelectionFromDOMRange(domRange);
      var sel = this.getDocument().createSelection(range);
      this.setSelection(sel);
    }
  };

  this.rerenderDomSelection = function() {
    if (this.domSelection) {
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

  this.onDocumentChange = function(change, info) {
    // dirty text properties which need to be updated due to selection changes
    var updates = this._updateSelectionFragments();
    // plus all text properties affected by the change
    change.updated.forEach(function(_, path) {
      updates[path] = true;
    });
    // update text properties and rerender node fragments
    this._updateTextProperties(updates);

    var sel = this.getSelection();

    // rerender the DOM selection
    if (this.domSelection && !info.remote) {
      // console.log('Rerendering DOM selection after document change.', this.__id__);
      // HACK: under FF we must make sure that the contenteditable is
      // focused.
      if (change.after.surfaceId === this.getName()) {
        if (!this.hasNativeFocus) {
          this.skipNextFocusEvent = true;
          this.el.focus();
        }
        this.rerenderDomSelection();
      }
    }

    this.emit('selection:changed', sel, this);
  };

  this.onCollaboratorsChange = function() {
    this._rerenderSelection();
  };

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
    // console.log('MouseDown on Surface %s', this.__id__);
    // 'mouseDown' is triggered before 'focus' so we tell
    // our focus handler that we are already dealing with it
    // The opposite situation, when the surface gets focused event.g. using keyboard
    // then the handler needs to kick in and recover a persisted selection or such
    this.skipNextFocusEvent = true;
    // Bind mouseup to the whole document in case of dragging out of the surface
    if (this.documentEl) {
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
    console.info("We want to enable a DOM MutationObserver which catches all changes made by native interfaces (such as spell corrections, etc). Lookout for this message and try to set Surface.skipNextObservation=true when you know that you will mutate the DOM.");
  };

  this.onDragStart = function(event) {
    event.preventDefault();
    event.stopPropagation();
  };

  this.onNativeBlur = function() {
    console.log('Native blur on surface', this.name);
    this.hasNativeFocus = false;
    if (this.skipNextFocusEvent) {
      this.skipNextFocusEvent = false;
      return;
    }
    this._rerenderSelection();
  };

  this.onNativeFocus = function() {
    console.log('Native focus on surface', this.name);
    this.hasNativeFocus = true;
    // in some cases we don't react on native focusing
    // e.g., when the selection is done via mouse
    // or if the selection is set implicitly
    if (this.skipNextFocusEvent) {
      this.skipNextFocusEvent = false;
      return;
    }
    this._rerenderSelection();
  };

  // Internal implementations

  this._initializeCommandRegistry = function(commands) {
    var commandRegistry = new Registry();
    each(commands, function(CommandClass) {
      var commandContext = extend({}, this.context, this.getChildContext());
      var cmd = new CommandClass(commandContext);
      commandRegistry.add(CommandClass.static.name, cmd);
    }.bind(this));
    this.commandRegistry = commandRegistry;
  };

  this._handleLeftOrRightArrowKey = function (event) {
    event.stopPropagation();
    var self = this;
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      if (self._isDisposed()) return;
      var options = {
        direction: (event.keyCode === keys.LEFT) ? 'left' : 'right'
      };
      self._updateModelSelection(options);
      // We could rerender the selection, to make sure the DOM is representing
      // the model selection
      // TODO: ATM, the DOMSelection is not good enough in doing this, event.g., there
      // are situations where one can not use left/right navigation anymore, as
      // DOMSelection will always decides to choose the initial positition,
      // which means lockin.
      // self.rerenderDomSelection();
    });
  };

  this._handleUpOrDownArrowKey = function (event) {
    event.stopPropagation();
    var self = this;
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      if (self._isDisposed()) return;
      var options = {
        direction: (event.keyCode === keys.UP) ? 'left' : 'right'
      };
      self._updateModelSelection(options);
    });
  };

  this._isDisposed = function() {
    // HACK: if domSelection === null, this surface has been disposed
    return !this.domSelection;
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
    var hasChanged = this.documentSession._setSelection(sel);
    // Since we allow the surface be blurred natively when clicking
    // on tools we now need to make sure that the element is focused natively
    // when we set the selection
    // This is actually only a problem on FF, other browsers set the focus implicitly
    // when a new DOM selection is set.
    // ATTENTION: in FF 44 this was causing troubles, making the CE unselectable
    // until the next native blur.
    if (!sel.isNull() && this.el && !this.hasNativeFocus) {
      this.skipNextFocusEvent = true;
      this.el.focus();
    }
    if (this.domSelection) {
      this.domSelection.setSelection(sel);
    }
    if (hasChanged) {
      this._skipNextSelectionChange = true;
      this.documentSession.emit('selection:changed', sel, this.documentSession);
    }
  };

  this._rerenderSelection = function() {
    var updates = this._updateSelectionFragments();
    // re-render text properties and node fragments
    this._updateTextProperties(updates);
    // as the re-render before might have destroyed
    // an existing DOM selection, it needs to be rerendered, too
    if (this.domSelection && this.hasNativeFocus) {
      this.rerenderDomSelection();
    }
  };

  this._updateModelSelection = function(options) {
    var sel = this.domSelection.getSelection(options);
    // NOTE: this will also lead to a rerendering of the selection
    // triggered by the 'selection:changed' event
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
            console.log('FIXME: there should be a rendered cursor element.');
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
            console.log('FIXME: there should be a rendered selection fragments element.');
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
      // TODO: what do we need this for?
      each(this._annotations, function(_path, id) {
        if (isEqual(path, _path)) {
          delete this._annotations[id];
        }
      }.bind(this));
    }
  };

  this._getNodeComponent = function(nodeId) {
    var nodeEl = this.el.querySelector('*[data-id="'+nodeId+'"]');
    if (!nodeEl) {
      return null;
    }
    var comp = nodeEl.component;
    return comp;
  };

  this._getTextPropertyComponent = function(path) {
    return this._textProperties[path];
  };

  this._getFragments = function(path) {
    /* jshint unused:false */
    var frags = [];
    if (this._selectionFragments) {
      var selectionFragments = this._selectionFragments[path];
      if (selectionFragments) {
        frags = frags.concat(selectionFragments);
      }
    }
    return frags;
  };

  this._computeSelectionFragments = function(sel, selectionFragments, collaborator) {
    selectionFragments = selectionFragments || {};
    if (sel && !sel.isNull()) {
      // console.log('Computing selection fragments for', sel.toString());
      var doc = this.getDocument();
      var fragments = sel.getFragments();
      fragments.forEach(function(frag) {
        var key;
        if (frag.isNodeFragment()) {
          var node = doc.get(frag.getNodeId());
          // HACK: we replace NodeFragments for TextNodes
          // by a PropertyFragment so that the selection is rendered
          // in the same way as other property fragments
          if (node.isText()) {
            var path = node.getTextPath();
            var len = node.getText().length;
            frag = new Selection.Fragment(path, 0, len, true);
            key = path.join(',');
          } else {
            key = node.id;
          }
        } else {
          key = frag.path.toString();
        }
        var frags = selectionFragments[key];
        if (!frags) {
          frags = [];
          selectionFragments[key] = frags;
        }
        frag.collaborator = collaborator;
        frags.push(frag);
      });
    }
    return selectionFragments;
  };

  this._updateSelectionFragments = function() {
    var updates = {};
    var oldSelectionFragments = this._selectionFragments;
    var newSelectionFragments = {};
    // local selection
    var sel = this.getSelection();

    if (sel.surfaceId === this.name) {
      // Note: we don't render a cursor when this is focused
      // as otherwise we would interfer to much with ContentEditable.
      // Such as double-click makes troubles in FF.
      if (!this.hasNativeFocus && sel.isCollapsed()) {
        var path = sel.startPath;
        var offset = sel.startOffset;
        var key = path.toString();
        this._cursorFragment = new Selection.Cursor(path, offset);
        if (!newSelectionFragments[key]) {
          newSelectionFragments[key] = [];
        }
        newSelectionFragments[key].push(this._cursorFragment);
      } else if (!sel.isCollapsed()) {
        this._cursorFragment = null;
        this._computeSelectionFragments(sel, newSelectionFragments);
      }
    }
    // if this.documentSession is a CollabSession there might
    // be other collaborators, for which we want to show the selection too
    var collaborators = this.getDocumentSession().getCollaborators();
    if (collaborators) {
      each(collaborators, function(collaborator) {
        this._computeSelectionFragments(collaborator.selection, newSelectionFragments, collaborator);
      }.bind(this));
    }

    if (Object.keys(newSelectionFragments).length > 0) {
      this._selectionFragments = newSelectionFragments;
    } else {
      this._selectionFragments = null;
    }

    // properties which displayed the selection previously
    each(oldSelectionFragments, function(_, key) {
      updates[key] = true;
    });
    // properties which display the selection currently
    each(newSelectionFragments, function(_, key) {
      updates[key] = true;
    });
    return updates;
  };

  this._updateTextProperties = function(updatedTextProperties) {
    each(updatedTextProperties, function(_, pathStr) {
      var comp = this._textProperties[pathStr];
      if (comp) {
        comp.rerender();
      }
    }.bind(this));
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
