const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { Schema } = mongoose;

const resources_schema = new Schema({
	owner_id: String,
	path: String,
	type: String,
	parent_id: String,
	revisions: [],
	sharing :[],
	deleted: String,
	activity:[]
});

mongoose.model('Resources', resources_schema, 'resources');