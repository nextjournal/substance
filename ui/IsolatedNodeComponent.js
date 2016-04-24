'use strict';

var error = require('../util/error');
var Coordinate = require('../model/Coordinate');
var Component = require('./Component');

// It is not a good idea to derive the isolated node component's state from the
// selection. Needing a selectin when inside an IsolatedNode, makes it impossible to enable
// the contenteditable on the fly (does not work when clicking on an existing selection)
// Instead we should leave to the

function IsolatedNodeComponent() {
  IsolatedNodeComponent.super.apply(this, arguments);

  this.name = this.props.node.id;
  this._id = _createId(this);
  this._state = {
    selectionFragment: null
  };
}

function _createId(isolatedNodeComp) {
  var surfaceParent = isolatedNodeComp.getSurfaceParent();
  if (surfaceParent) {
    return surfaceParent.getId() + '/' + isolatedNodeComp.name;
  } else {
    return isolatedNodeComp.name;
  }
}

IsolatedNodeComponent.Prototype = function() {

  var _super = IsolatedNodeComponent.super.prototype;

  this._isIsolatedNodeComponent = true;

  this.getChildContext = function() {
    return {
      surfaceParent: this
    };
  };

  this.didMount = function() {
    _super.didMount.call(this);

    var docSession = this.context.documentSession;
    docSession.on('update', this.onSessionUpdate, this);
  };

  this.dispose = function() {
    _super.dispose.call(this);

    var docSession = this.context.documentSession;
    docSession.off(this);
  };

  this.render = function($$) {
    // console.log('##### IsolatedNodeComponent.render()', $$.capturing);
    var el = _super.render.apply(this, arguments);

    var node = this.props.node;
    el.addClass('sc-isolated-node')
      .attr("data-id", node.id);

    if (this.state.mode) {
      el.addClass('sm-'+this.state.mode);
    }

    el.on('mousedown', this.onMousedown);

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-before').ref('before')
        // zero-width character
        // .append("\uFEFF")
        // NOTE: better use a regular character otherwise Edge has problems
        .append("{")
    );

    var container = $$('div').addClass('se-container')
      .attr('contenteditable', false)
      .append(this.renderContent($$));
    el.append(container);

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-after').ref('after')
        // zero-width character
        // .append("\uFEFF")
        // NOTE: better use a regular character otherwise Edge has problems
        .append("}")
    );

    return el;
  };

  this.renderContent = function($$) {
    var node = this.props.node;
    var componentRegistry = this.context.componentRegistry;
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      error('Could not resolve a component for type: ' + node.type);
      return $$('div');
    } else {
      return $$(ComponentClass, {
        node: node,
        disabled: this.state.mode !== 'focused'
      }).ref('content');
    }
  };

  this.getId = function() {
    return this._id;
  };

  this.getSurfaceParent = function() {
    return this.context.surface;
  };

  this.onSessionUpdate = function(update) {
    if (update.selection) {
      // TODO: we need to change the DocumentSession update API
      // as it is important to know the old and new value
      var newSel = update.selection;
      var surfaceId = newSel.surfaceId;

      if (this.state.mode === 'focused') {
        if (surfaceId && !surfaceId.startsWith(this._id)) {
          this.setState({
            mode: null
          });
          return;
        }
      } else {
        var nodeId = this.props.node.id;
        var nodeIsSelected = (
          (surfaceId === this.getSurfaceParent().getId()) && (
            // (newSel.isNodeSelection() && newSel.getNodeId() === nodeId) ||
            (newSel.isContainerSelection() && newSel.containsNodeFragment(nodeId))
          )
        );
        // TODO: probably we need to dispatch the state to descendants
        if (!this.state.mode && nodeIsSelected) {
          this.setState({
            mode: 'selected'
          });
        } else if (this.state.mode === 'selected' && !nodeIsSelected) {
          this.setState({
            mode: null
          });
        }
      }
    }
  };

  this.onMousedown = function(event) {
    event.preventDefault();
    event.stopPropagation();

    switch (this.state.mode) {
      case 'selected':
        this.setState({ mode: 'focused' });
        break;
      case 'focused':
        break;
      default:
        this._selectNode();
        this.setState({ mode: 'focused' });
    }
  };

  this._selectNode = function() {
    var surface = this.context.surface;
    var doc = surface.getDocument();
    var node = this.props.node;
    surface.setSelection(doc.createSelection({
      type: 'container',
      containerId: surface.getContainerId(),
      startPath: [node.id],
      startOffset: 0,
      endPath: [node.id],
      endOffset: 1
    }));
    this.el.focus();
  };

};

Component.extend(IsolatedNodeComponent);

IsolatedNodeComponent.getCoordinate = function(surfaceEl, node) {
  // special treatment for block-level isolated-nodes
  var parent = node.getParent();
  if (node.isTextNode() && parent.is('.se-isolated-node-boundary')) {
    var boundary = parent;
    var isolatedNodeEl = boundary.getParent();
    var nodeId = isolatedNodeEl.getAttribute('data-id');
    if (nodeId) {
      var charPos = 0;
      if (boundary.is('sm-after')) {
        charPos = 1;
      }
      return new Coordinate([nodeId], charPos);
    } else {
      error('FIXME: expecting a data-id attribute on IsolatedNodeComponent');
    }
  }
  return null;
};

IsolatedNodeComponent.getDOMCoordinate = function(comp, coor) {
  var domCoor;
  if (coor.offset === 0) {
    domCoor = {
      container: comp.refs.before.getNativeElement().firstChild,
      offset: 0
    };
  } else {
    domCoor = {
      container: comp.refs.after.getNativeElement().firstChild,
      offset: 1
    };
  }
  return domCoor;
};

module.exports = IsolatedNodeComponent;
