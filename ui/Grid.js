'use strict';

var Component = require('./Component');

/*
  Simple component for realizing grid layouts
*/
function Grid() {
  Component.apply(this, arguments);
}

Grid.Prototype = function() {

  this.render = function($$) {
    var el = $$('div').addClass('sc-grid');
    if (this.props.mobile) {
      el.addClass('sm-mobile');
    }
    for (var i = 0; i < this.props.children.length; i++) {
      var rowEl = this.props.children[i];
      if (rowEl.ComponentClass !== Grid.Row) {
        throw new Error('Expecting Grid.Row elements');
      }
      rowEl.props.columns = this.props.columns;
      el.append(rowEl);
    }
    return el;
  };
};

Component.extend(Grid);

/*
  A grid row
*/
function Row() {
  Component.apply(this, arguments);
}

Row.Prototype = function() {

  this.render = function($$) {
    var el = $$('div').addClass('se-row');
    for (var i = 0; i < this.props.children.length; i++) {
      var cellEl = this.props.children[i];
      if (cellEl.ComponentClass !== Grid.Cell) {
        throw new Error('Expecting Grid.Cell elements');
      }
      // manual layout: $$(Cell, { columns: 1-12 })
      // auto: using Grid configuration (3 columns)
      //       $$(Grid, { columns: [2, 2, 8]})
      if (!cellEl.props.columns && this.props.columns) {
        cellEl.props.columns = this.props.columns[i] || 1;
      }
      el.append(cellEl);
    }
    return el;
  };
};

Component.extend(Row);

/*
  A grid cell
*/
function Cell() {
  Component.apply(this, arguments);
}

Cell.Prototype = function() {

  this.render = function($$) {
    var el = $$('div').addClass('se-cell');
    // The naming 'sm-column' is counter intuitive
    // as this value describes a width
    // maybe better sm-width?
    // FIXME: The internal layout implementation needs to be known to the user.
    // This should be abstracted by using a props 'colspan'
    // which then is turned into an sm-column value
    el.addClass('sm-columns-'+this.props.columns);
    el.append(this.props.children);
    return el;
  };
};

Component.extend(Cell);

Grid.Row = Row;
Grid.Cell = Cell;

module.exports = Grid;