'use strict';

var error = require('../util/error');
var Coordinate = require('../model/Coordinate');
var Component = require('./Component');

function IsolatedNodeComponent() {
  IsolatedNodeComponent.super.apply(this, arguments);
}

IsolatedNodeComponent.Prototype = function() {

  var _super = IsolatedNodeComponent.super.prototype;

  this._isIsolatedNodeComponent = true;

  this.willReceiveProps = function(nextProps) {
    this.setState({
      mode: nextProps.mode
    });
  };

  this.render = function($$) {
    // console.log('##### IsolatedNodeComponent.render()', $$.capturing);
    var el = _super.render.apply(this, arguments);

    var node = this.props.node;
    el.addClass('sc-isolated-node')
      .attr("data-id", node.id)
      .on('mousedown', this.onMousedown);

    if (this.state.mode) {
      el.addClass('sm-'+this.state.mode);
    }

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-before').ref('before')
        // zero-width character
        .append("\uFEFF")
    );

    var container = $$('div').addClass('se-container')
      .attr('contenteditable', false)
      .append(this.renderContent($$));
    el.append(container);

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-after').ref('after')
        // zero-width character
        .append("\uFEFF")
    );

    return el;
  };

  // this.didUpdate = function() {
  //   _super.didUpdate.apply(this, arguments);

  //   if (this.state.mode !== 'unfocused') {
  //     this.context.controller.setActiveIsolatedNode(this);
  //   }
  // };

  this.renderContent = function($$) {
    var node = this.props.node;
    var componentRegistry = this.context.componentRegistry;
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      error('Could not resolve a component for type: ' + node.type);
      return $$('div');
    } else {
      return $$(ComponentClass, { node: node });
    }
  };

  this.onMousedown = function(event) {
    // console.log('IsolatedNode %s: mousedown', this.props.node.id);
    event.preventDefault();
    event.stopPropagation();
    switch (this.state.mode) {
      case 'focused':
        this.activate();
        this.setState({
          mode: 'active'
        });
        break;
      default:
        this._selectNode();
        break;
    }
  };

  this.activate = function() {};

  this.deactivate = function() {};

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
