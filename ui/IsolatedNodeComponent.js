'use strict';

var Component = require('./Component');
var Coordinate = require('../model/Coordinate');

function IsolatedNodeComponent() {
  IsolatedNodeComponent.super.apply(this, arguments);
}

IsolatedNodeComponent.Prototype = function() {

  var _super = IsolatedNodeComponent.super.prototype;

  this._isIsolatedNodeComponent = true;

  this.render = function($$) {
    var el = _super.render.apply(this, arguments);

    var node = this.props.node;
    el.addClass('sc-isolated-node')
      .attr("data-id", node.id);

    if (this.mode) {
      el.addClass('sm-' + this.mode);
    }
    el.on('mousedown', this.onMousedown);

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-before').ref('before').append('[')
    );

    var container = $$('div').addClass('se-container')
      .attr('contenteditable', false)
      .append(this.renderContent($$));
    el.append(container);

    el.append(
      $$('div').addClass('se-isolated-node-boundary').addClass('sm-after').ref('after').append(']')
    );

    return el;
  };

  this.renderContent = function($$) { /* jshint unused:false */};

  this.onMousedown = function(event) {
    console.log('NestedSurface %s: mousedown', this.props.node.id);
    if (!this.mode) {
      console.log('NestedSurface %s: selecting node', this.props.node.id);
      event.preventDefault();
      event.stopPropagation();
      this._selectNode();
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
    this._setSelected();
  };

  this._setSelected = function() {
    this.mode = 'selected';
    this.removeClass('sm-focused').addClass('sm-selected');
  };

  this._focus = function() {
    this.mode = 'focused';
    this.removeClass('sm-selected').addClass('sm-focused');
  };

  this._blur = function() {
    this.mode = null;
    this.removeClass('sm-focused').removeClass('sm-selected');
  };

  this._getCoor = function(which) {
    var el, offset;
    if (which === 'before') {
      el = this.el;
      offset = 0;
    } else {
      el = this.el;
      offset = 3;
    }
    return {
      container: el,
      offset: offset
    };
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
      console.error('FIXME: expecting a data-id attribute on IsolatedNodeComponent');
    }
  }
  return null;
};

IsolatedNodeComponent.getDOMCoordinate = function(comp, coor) {
  var domCoor;
  if (coor.offset > 0) {
    domCoor = {
      container: comp.refs.after.getNativeElement(),
      offset:1
    };
  } else {
    domCoor = {
      container: comp.refs.before.getNativeElement(),
      offset:0
    };
  }
  return domCoor;
};

module.exports = IsolatedNodeComponent;
