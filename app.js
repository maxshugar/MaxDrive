const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const mongo = require('mongodb');
const uuidv1 = require('uuid/v1');
const AWS = require('aws-sdk');
var exec = require('child_process').exec;
var url = require('url')

mongoose.promise = global.Promise; 

const app = express();

AWS.config.loadFromPath('./config.json');

app.use(cors());
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(express.static(__dirname + '/views'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(function(err, req, res, next){
	if(err) return res.json(err);
});

/* Connect to MongoDB Atlas. */
fs.readFile(__dirname + '/mongouri.txt', 'utf8', function(err, contents){
	if(err)
		console.log(err);
	else
		mongoose.connect(contents, {useNewUrlParser: true});
});

require('./models/users');

const Users = mongoose.model('Users');

app.use(cookieParser());

app.get('/',function(req,res) {
	//res.render('landing.html', {});
	res.redirect('/login');
});

app.get('/register',function(req,res) {
	res.render('register.html');
});

app.get('/login',function(req,res) {
	res.render('login.html');
});  

/* Handle route to the users root folder. */
app.get('/gateway', verify_token, function(req,res) {
	
	if(mongoose.Types.ObjectId.isValid(req.client_id)){
		res.redirect('api/users/' + req.client_id + '/resources/root');
	}
	
}); 

app.get('/logout',function(req,res) {
	res.render('login.html');
});

/* Middleware function that verifies the authenticity of a JWT cookie. */
function verify_token(req, res, next){
	/* Get cookie. */
	var token = req.cookies['jwt'];
	if (!token)
		return res.redirect('/login');
	jwt.verify(token, 'Shhh!', function(err, decoded) {
		if (err) res.redirect('/login');
		/* If JWT is valid, save _id to request for use in other routes. */
		req.client_id = decoded._id;
		return next();
	});
}

function verify_admin(req, res, next){

	/* Get cookie. */
	var token = req.cookies['admin'];
	if (token != "super_secret_password")
		return res.status(400).json({error: 'You are not server admin.'});
	return next();
}

/* Retrieves all users. */
app.get('/api/users', verify_admin, (req, res, next) => {
	return Users.find({}).select('_id email').then((users) =>{
		if(users.length === 0)
			return res.sendStatus(400);
		
		return res.json(users);   
	});
});

/* Create an account. */
app.post('/api/users', (req, res, err) => {
	
	/* Validate email */
	if(!req.body.email){
		return res.status(422).json({
			error:{
				email: 'is required'
			}
		});
	}  
	
	/* Validate password */
	if(!req.body.password){
		return res.status(422).json({
			error:{
				password: 'is required'
			}
		});
	}
	
	/* Check email is unique. */
	Users.findOne({ 'email' : req.body.email }, function(err, user){
		if(user)
			return res.json({error : "Email address is already registered to another user."});
		else {
			
			var user = {
				email: req.body.email,
				password: req.body.password,
				resources: {
					"type": "folder",
					"guid": "root",
					"name": req.body.email,
					"items": [],
					"revisions": []
				}
			}
			
			const finalUser = new Users(user);
			finalUser.set_password(req.body.password);
			/* Return token. */
			finalUser.save();
			return res.cookie('jwt', finalUser.generate_jwt()).json({success: 'Registration complete.', _id: finalUser._id});
		
		}
	});
	
});

/* Returns jwt on submission of valid login credentials. */
app.post('/api/login', (req, res, err) => {
	
	var email = req.body.email;
	var password = req.body.password;
	
	if(!email){
		return res.status(422).json({
			errors: {
				email: 'is required'
			}
		});
	} 
	if(!password){
		return res.status(422).json({
			errors: {
				password: 'is required'
			}
		});
	}
	
	Users.findOne({ 'email' : req.body.email }, function(err, user){
		if(!user || !user.validate_password(password)){
			return res.json({ error: 'email or password is incorrect.'});
		} else {
			return res.cookie('jwt', user.generate_jwt()).json({success: 'Registration complete.'});
		}
	});

});

app.get('/api/users/:id', verify_admin, (req, res) => {
	
	if(mongoose.Types.ObjectId.isValid(req.params.id)){
		var id = mongoose.Types.ObjectId(req.params.id);
		Users.find({_id: id}, function(err, user){
			if(!user){
				return res.json({error: "User with id " + req.params.id + " not found."});
			} else{
				return res.json(user);
			}
		});
	} else {
		return res.json({error: "id '" + req.params.id + "' is invalid."});
	}
	
});

app.put('/api/users/:id', verify_admin, (req, res) => {
	
	if(mongoose.Types.ObjectId.isValid(req.params.id)){
		var id = mongoose.Types.ObjectId(req.params.id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "User with id " + req.params.id + " not found."});
			} else{
				if(req.body.user === undefined)
					return res.json({error: "Please use {user:{}} in request body."});
				else {
					for (attr in req.body.user){
						/* Don't let salt or hash be updated. */
						if(attr != 'salt' && attr != 'hash'){	
							if(attr in user[0]){
								user[0][attr] = req.body.user[attr];
							}
						}
					}
					Users.findOneAndUpdate({_id: id}, user[0], {new: true, upsert:true}, function(err, user){
						if(err) return res.json({error: err});
						else return res.json(user);
					});
				}       
			}
		});
	} else {
		return res.json({error: "id '" + req.params.id + "' is invalid."});
	}
	
});

app.delete('/api/users/:id', verify_admin, (req, res) => {
	
	if(mongoose.Types.ObjectId.isValid(req.params.id)){
		var id = mongoose.Types.ObjectId(req.params.id);
		Users.find({_id: id}, function(err, user){
			if(!user){
				return res.json({error: "User with id " + req.params.id + " not found."});
			} else{
				Users.deleteOne({ _id: id }, function (err) {
				  if (err) return res.json(err);
				  else return res.json({success: 'User ' + id + ' deleted successfully.'});
				});
			}
		});
	} else {
		return res.json({error: "id '" + req.params.id + "' is invalid."});
	}
	
});

/* Get current logged in user. Development purposes only. */
app.get('/api/users/current', verify_token, (req, res) => {
	
	var owner_id = req.body.resource.owner_id;
	var path = req.body.resource.path;
	var type = req.body.resource.type;
	var parent_id = req.body.resource.parent_id;
	var revisions = req.body.resource.revisions;
	var sharing = req.body.resource.sharing;
	var deleted = req.body.resource.deleted;
	var activity = req.body.resource.activity;
	
	
	return Users.findById(req.user_id).then((user) =>{
		if(user.length === 0){
			return res.sendStatus(400);
		}
		return res.json({user: user.to_auth_json() });
	});
});

/* Get resource. */
app.get('/api/users/:owner_id/resources/:resource_id', verify_token, function(req,res) {
	
	if(mongoose.Types.ObjectId.isValid(req.params.owner_id)){
		var id = mongoose.Types.ObjectId(req.params.owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){ 
				return res.json({error: "Owner with id " + req.params.owner_id + " doesn't exist."});
			} else{
				
				var breadcrumbs = [];
				
				function find_resource(obj){
					var res = null;
					/* Is the folder the target. */
					if(obj.guid == req.params.resource_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							/* Is the item the target? */
							if(obj.items[i].guid == req.params.resource_id){
								breadcrumbs.unshift(obj.items[i]);
								res = obj.items[i];
							}
							else if(obj.items[i].type == 'folder'){
								var ret = find_resource(obj.items[i]);
								if(ret != null) {
									breadcrumbs.unshift(obj.items[i]);
									res = ret;
								}
							}
						}
					}
					return res;
				}
				
				
				var folder = find_resource(user[0].resources);
				if(folder == null){
					return res.json({error: "Resource with id '" + req.params.resource_id + "' doesn't exist."});
				}
				/* Push root to beginning to breadcurmbs array. */
				breadcrumbs.unshift(user[0].resources);
				
				/* Check if user is authorized to access resource through sharing. */
				var found_flag = false;
				for(var i = 0; i < breadcrumbs.length; i++){
					if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
						for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
							if(breadcrumbs[i].sharing[j]._id == req.client_id)
								found_flag = true;
						}
					}
				}
				
				if(req.params.owner_id != req.client_id && found_flag == false){
					return res.status(400).json({error: "You don't have access to this resource."});
				}
				
				/* Get client email for EJS. */
				Users.find({_id: req.client_id}, function(err, client){
					
					return res.render('resources.html', {client_email: client[0].email, folder: JSON.stringify(folder), owner: user[0], breadcrumbs: JSON.stringify(breadcrumbs)});
				});
				
				

			}
		});
	} else {
		return res.json({error: "user id '" + req.params.user_id + "' is invalid."});
	}
	
});

/* Format resources for tree view. */
app.get('/api/users/:owner_id/treeview/:omit_id', verify_token, function(req,res) {
	
	var omit_id = req.params.omit_id;
	
	if(mongoose.Types.ObjectId.isValid(req.params.owner_id)){
		var id = mongoose.Types.ObjectId(req.params.owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "Owner with id " + req.params.owner_id + " doesn't exist."});
			} else{
				
				var flat = [];
				
				/* Generates ordered array of folders. */
				function convert_to_flat(obj, parent_id){
					
					for(var i = 0; i < obj.items.length; i++){
						if(obj.items[i].type == 'folder'){ /* No files just folders. */
							flat.push( { text: obj.items[i].name, guid: obj.items[i].guid, parent_id: parent_id, children: [] } );
							convert_to_flat(obj.items[i], obj.items[i].guid);
						}
					}
					
				}
				
				convert_to_flat(user[0].resources, 'root');
				
				var tree = [];
				
				/* Add root to tree */
				for(var i = 0; i < flat.length; i++){
					
					if(flat[i].parent_id == 'root' && flat[i].guid != omit_id){
						flat[i]["children"] = [];
						tree.push(flat[i]);
						flat.splice(i, 1);
						i--;
					}

				}
				
				function add_to_tree(branch, folder){
					
					for(var i = 0; i < branch.length; i++){
						if(branch[i].guid == folder.parent_id){
							branch[i].children.push(folder);
						}
						else {
							add_to_tree(branch[i].children, folder);
						}
					}
				}
				
				/* Add each item in the tree. */
				for(var i = 0; i < flat.length; i++){

					if(flat[i].guid != omit_id)
						add_to_tree(tree , flat[i]);
					
				}
				
				res.json(tree);
				
			}
		});
	} else {
		return res.json({error: "user id '" + req.params.user_id + "' is invalid."});
	}
	
});

/* Create a new resource. 

@param owner_id
@param folder_id
@param type
@param revisions

*/
app.post('/api/users/:owner_id/resources', verify_token, (req, res) =>{

	var owner_id = req.params.owner_id;
	var target_folder_id = req.body.target_folder_id;
	var current_folder_id = req.body.current_folder_id;
	
	var name = req.body.name;
	var type = req.body.type;
	var guid = req.body.guid;
	var activity = req.body.activity;
	var items = req.body.items;
	var revisions = req.body.revisions;
	var sharing = req.body.items;
	
	if(owner_id === undefined)
		return res.json({ error: 'owner_id is required.' });
	if(target_folder_id === undefined)
		return res.json({ error: 'target_folder_id is required.' });
	if(current_folder_id === undefined)
		current_folder_id = target_folder_id;
	
	if(name === undefined)
		return res.json({ error: 'name is required.' });
	if(type === undefined)
		return res.json({ error: 'type is required' });
	
	if(guid === undefined)
		guid = uuidv1();
	if(activity === undefined)
		activity = [];
	if(items === undefined)
		items = [];
	if(revisions === undefined)
		revisions = [];
	if(sharing === undefined)
		sharing = [];
	
	/* Check if owner_id is valid. */
	if(mongoose.Types.ObjectId.isValid(owner_id)){
		var id = mongoose.Types.ObjectId(owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "owner_id " + owner_id + " not found."});
			} else{
				
				var breadcrumbs = [];
				
				function find_resource(obj){
					var res = null;
					/* Is the folder the target. */
					if(obj.guid == target_folder_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							/* Is the item the target? */
							if(obj.items[i].guid == target_folder_id){
								breadcrumbs.unshift(obj.items[i]);
								res = obj.items[i];
							}
							else if(obj.items[i].type == 'folder'){
								var ret = find_resource(obj.items[i]);
								if(ret != null) {
									breadcrumbs.unshift(obj.items[i]);
									res = ret;
								}
							}
						}
					}
					return res;
				}
				
				var folder = find_resource(user[0].resources);
				if(folder == null){
					return res.json({error: "Resource with id '" + req.params.resource_id + "' doesn't exist."});
				}
				/* Push root to beginning of breadcurmbs array. */
				breadcrumbs.unshift(user[0].resources);
				
				/* Check if user is authorized to access resource through sharing. */
				var found_flag = false;
				for(var i = 0; i < breadcrumbs.length; i++){
					if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
						for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
							if(breadcrumbs[i].sharing[j]._id == req.client_id)
								found_flag = true;
						}
					}
				}
				
				if(owner_id != req.client_id && found_flag == false){
					return res.status(400).json({error: "You don't have access to this resource."});
				}
				
				var payload = {
						'guid': guid, 'name': name, 'type': type, 'items': items, 'revisions': revisions, 'sharing': sharing, 'activity': activity
				};
				
				folder.items.push(payload);
				
				const finalUser = new Users(user[0]);
				
				/* Return the folder requested by the client. */
				function find_current_folder(obj){
					var res = null;
					if(obj.guid == current_folder_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							if(obj.items[i].type == 'folder'){
								var ret = find_current_folder(obj.items[i]);
								if(ret != null) res = ret;
							}
						}
					}
					return res;
				}
				
				folder = find_current_folder(finalUser.resources);
				
				return finalUser.save().then(()=> res.json(folder));
				
			}
		});
	} else {
		return res.json({error: "owner_id '" + owner_id + "' is invalid."});
	}
	
});

/* Delete a resource. */
app.delete('/api/users/:owner_id/resources/:resource_id', verify_token, (req, res) =>{
	
	var owner_id = req.params.owner_id;
	var target_id = req.body.target_id;
	var resource_id = req.params.resource_id;
	
	if(target_id === undefined)
		return res.json({ error: 'target_id is required.' });

	/* Check if owner_id is valid. */
	if(mongoose.Types.ObjectId.isValid(owner_id)){
		var id = mongoose.Types.ObjectId(owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "owner_id " + owner_id + " not found."});
			} else{

				var breadcrumbs = [];
				
				function find_resource(obj){
					var res = null;
					/* Is the folder the target. */
					if(obj.guid == req.params.resource_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							/* Is the item the target? */
							if(obj.items[i].guid == req.params.resource_id){
								breadcrumbs.unshift(obj.items[i]);
								res = obj.items[i];
							}
							else if(obj.items[i].type == 'folder'){
								var ret = find_resource(obj.items[i]);
								if(ret != null) {
									breadcrumbs.unshift(obj.items[i]);
									res = ret;
								}
							}
						}
					}
					return res;
				}
			
				var folder = find_resource(user[0].resources);
				if(folder == null){
					return res.json({error: "Resource with id '" + req.params.resource_id + "' doesn't exist."});
				}
				/* Push root to beginning of breadcurmbs array. */
				breadcrumbs.unshift(user[0].resources);
				
				/* Check if user is authorized to access resource through sharing. */
				var found_flag = false;
				for(var i = 0; i < breadcrumbs.length; i++){
					if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
						for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
							if(breadcrumbs[i].sharing[j]._id == req.client_id)
								found_flag = true;
						}
					}
				}
				
				if(owner_id != req.client_id && found_flag == false){
					return res.status(400).json({error: "You don't have access to this resource."});
				}
				
				/* Delete the resource from the folder. */
				for(var i = 0; i < folder.items.length; i++){
					if(folder.items[i].guid == target_id)
						folder.items.splice(i, 1);
				}
				
				const finalUser = new Users(user[0]);
				return finalUser.save().then(()=> res.json(folder));
					
			}
		});
	} else {
		return res.json({error: "owner_id '" + owner_id + "' is invalid."});
	}
	
});

/* Update a resource in a folder. */
app.put('/api/users/:owner_id/resources/:resource_id', verify_token, (req, res) =>{
	
	var owner_id = req.params.owner_id;
	var target = req.body.target;
	var resource_id = req.params.resource_id;
	
	if(target === undefined)
		return res.json({ error: 'target is required.' });

	/* Check if owner_id is valid. */
	if(mongoose.Types.ObjectId.isValid(owner_id)){
		var id = mongoose.Types.ObjectId(owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "owner_id " + owner_id + " not found."});
			} else{
				
				var breadcrumbs = [];
				
				function find_resource(obj){
					var res = null;
					/* Is the folder the target. */
					if(obj.guid == req.params.resource_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							/* Is the item the target? */
							if(obj.items[i].guid == req.params.resource_id){
								breadcrumbs.unshift(obj.items[i]);
								res = obj.items[i];
							}
							else if(obj.items[i].type == 'folder'){
								var ret = find_resource(obj.items[i]);
								if(ret != null) {
									breadcrumbs.unshift(obj.items[i]);
									res = ret;
								}
							}
						}
					}
					return res;
				}
				
				var folder = find_resource(user[0].resources);
				if(folder == null){
					return res.json({error: "Resource with id '" + req.params.resource_id + "' doesn't exist."});
				}
				/* Push root to beginning of breadcurmbs array. */
				breadcrumbs.unshift(user[0].resources);
				
				/* Check if user is authorized to access resource through sharing. */
				var found_flag = false;
				for(var i = 0; i < breadcrumbs.length; i++){
					if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
						for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
							if(breadcrumbs[i].sharing[j]._id == req.client_id)
								found_flag = true;
						}
					}
				}
				
				if(owner_id != req.client_id && found_flag == false){
					return res.status(400).json({error: "You don't have access to this resource."});
				}
				
				/* Update the target resource. */
				for(var i = 0; i < folder.items.length; i++){
					if(folder.items[i].guid == target.guid)
						folder.items[i] = target;
				}
				
				const finalUser = new Users(user[0]);
				return finalUser.save().then(()=> res.json(folder));
					
			}
		});
	} else {
		return res.json({error: "owner_id '" + owner_id + "' is invalid."});
	}
	
});

/* Convert a file revision to PDF using Libre Office. */
app.put('/api/users/:owner_id/resources/:resource_id/generate_preview', verify_token, (req, res) => {
	
	var owner_id = req.params.owner_id;
	var resource_id = req.params.resource_id;
    var target = req.body.target;
	var index = req.body.index;    
	var new_guid = req.body.new_guid;

        if(target === undefined)
                return res.json({ error: 'target is required.' });

	 /* Check if owner_id is valid. */
        if(mongoose.Types.ObjectId.isValid(owner_id)){
                var id = mongoose.Types.ObjectId(owner_id);
                Users.find({_id: id}, function(err, user){
                        if(user.length === 0){
                                return res.json({error: "owner_id " + owner_id + " not found."});
                        } else{

                                var breadcrumbs = [];
				
							/* Find the target resource folder. */
							function find_resource(obj){
									var res = null;
									/* Is the folder the target. */
									if(obj.guid == resource_id){
											res = obj;
									} else {
											for(var i = 0; i < obj.items.length; i++){
													/* Is the item the target? */
													if(obj.items[i].guid == resource_id){
															breadcrumbs.unshift(obj.items[i]);
															res = obj.items[i];
													}
													else if(obj.items[i].type == 'folder'){
															var ret = find_resource(obj.items[i]);
															if(ret != null) {
																	breadcrumbs.unshift(obj.items[i]);
																	res = ret;
															}
													}
											}
									}
									return res;
								}

                                var resource = find_resource(user[0].resources);
                                if(resource == null){
                                        return res.json({error: "Resource with id '" + req.params.resource_id + "' doesn't exist."});
                                }
                                /* Push root to beginning of breadcurmbs array. */
                                breadcrumbs.unshift(user[0].resources);

								/* Check if user is authorized to access resource through sharing. */
                                var found_flag = false;
                                for(var i = 0; i < breadcrumbs.length; i++){
                                        if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
                                                for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
                                                        if(breadcrumbs[i].sharing[j]._id == req.client_id)
                                                                found_flag = true;
                                                }
                                        }
                                }

                                if(owner_id != req.client_id && found_flag == false){
                                        return res.status(400).json({error: "You are not authorized to access this resource."});
                                }
				
								var s3_id = target.revisions[index].guid;
								var s3_key = owner_id + '/' + s3_id;
								
					
								var s3 = new AWS.S3();
								
								var params = {
									Bucket    : 'maxdrive',
									Key    : s3_key,
								};
							
								s3.getObject(params, function(err, data){
									if (err){
										res.status(400).json({message: err});
										return console.log(err);
									}
									var original_file_path = "/home/ec2-user/convert/" + s3_id; 
									fs.writeFile(original_file_path, data.Body, (err) => {
										if (err){
											res.status(400).json({message: err});
											return console.log(err);
										} 
										console.log("Successfully downloaded file to " + original_file_path);

										
										var cmd = "/home/ec2-user/temp/instdir/program/soffice --headless --convert-to pdf " + original_file_path + " --outdir /home/ec2-user/convert";
										require('child_process').execSync(cmd).toString();
										console.log("File conversion to " + original_file_path + ".pdf complete.");

										/* Delete original. */
										fs.unlinkSync(original_file_path);

										/* Upload to s3. */
											fs.readFile('/home/ec2-user/convert/' + s3_id + '.pdf', function (err, data){
												if (err){
													res.status(400).json({message: err});
													return console.log(err);
												}
												
												var objKey = owner_id + '/' + new_guid;
												var params = {
													Bucket: 'maxdrive',
													Key: objKey,
													ContentType: 'application/pdf',
													Body: data,
													ContentDisposition: "attachment; filename=" + new_guid
												};
												
												s3.upload(params, function(err, data) {
													if (err){
														res.status(400).json({message: err});
														return console.log(err);
													} 
										
													/* Add preview to user. */
													console.log('Successfully uploaded ' + objKey + 'to S3.');
													
													/* Delete converted file. */
													fs.unlinkSync(original_file_path + '.pdf');

													/* Set preview property. */
													for(var i = 0; i < resource.items.length; i++){
														if(resource.items[i].guid == target.guid){
															resource.items[i].revisions[index].preview = new_guid;
															break;
														}
													}

												
													const finalUser = new Users(user[0]);
													return finalUser.save().then(()=> res.json({data: resource, key: new_guid}));
													
												});
											})
										
										
									});
								});	
			}
		});
	}
});

app.get('/api/s3_token', verify_token, (req, res) => {

		generate_s3_token(req.client_id)
		.then(function(result){
			res.json({ 
				accessKeyId: result.Credentials.AccessKeyId,
				secretAccessKey: result.Credentials.SecretAccessKey,
				sessionToken: result.Credentials.SessionToken,
				region: "eu-west-2" 
			});
		})
		.catch(function(err){
			res.json(err);
		});

});

app.post('/api/download_file', verify_token, (req, res) => {
		
	var key = req.body.key;
	var s3 = new AWS.S3();

	const url = s3.getSignedUrl('getObject', {
	Bucket: 'maxdrive',
	Key: key,
	Expires: 1800
	})

	//res.json({ url : encodeURIComponent(url) });
	res.json({ url : url });
});

app.put('/api/users/:owner_id/resources/:resource_id/share', verify_token, (req, res) => {

	var owner_id = req.params.owner_id;
	var resource_id = req.params.resource_id;
	var target_id = req.body.target_id;
	var email = req.body.email;

	if(email === undefined)
		return res.json({ message: 'email is required.' });

	/* Check if owner_id is valid. */
	if(mongoose.Types.ObjectId.isValid(owner_id)){
		var id = mongoose.Types.ObjectId(owner_id);
		Users.find({_id: id}, function(err, user){
			if(user.length === 0){
				return res.json({error: "owner_id " + owner_id + " not found."});
			} else{
	
				/* Check if user with email owns resource. */
				if(user[0].email == email){
					return res.status(400).json({message: "Cannot be shared with the resource owner."});
				}

				var breadcrumbs = [];
				
				function find_resource(obj){
					var res = null;
					/* Is the folder the target. */
					if(obj.guid == req.params.resource_id){
						res = obj;
					} else {
						for(var i = 0; i < obj.items.length; i++){
							/* Is the item the target? */
							if(obj.items[i].guid == req.params.resource_id){
								breadcrumbs.unshift(obj.items[i]);
								res = obj.items[i];
							}
							else if(obj.items[i].type == 'folder'){
								var ret = find_resource(obj.items[i]);
								if(ret != null) {
									breadcrumbs.unshift(obj.items[i]);
									res = ret;
								}
							}
						}
					}
					return res;
				}
				
				var folder = find_resource(user[0].resources);
				if(folder == null){
					return res.status(400).json({message: "Resource with id '" + resource_id + "' doesn't exist."});
				}
				/* Push root to beginning of breadcurmbs array. */
				breadcrumbs.unshift(user[0].resources);
				
				/* Check if user is authorized to access resource through sharing. */
				var found_flag = false;
				for(var i = 0; i < breadcrumbs.length; i++){
					if(typeof breadcrumbs[i]["sharing"] != 'undefined'){
						for(var j = 0; j < breadcrumbs[i].sharing.length; j++){
							if(breadcrumbs[i].sharing[j]._id == req.client_id)
								found_flag = true;
						}
					}
				}
				
				if(owner_id != req.client_id && found_flag == false){
					return res.status(400).json({message: "You don't have access to this resource."});
				}
				
			/* Check if email exists. */
			Users.find({email: email}, function(err, user_){
				console.log(user);
				if(err){
					return res.status(400).json({message: err});
				} else if(user_.length == 0){
					return res.status(400).json({message: "Email '" + email + "' is not associated with a user."});
				} else if (user_.length > 0){

			

					/* Update the target resource. */
					for(var i = 0; i < folder.items.length; i++){
						if(folder.items[i].guid == target_id){
							var found_flag = false;
							for(var j = 0; j < folder.items[i].sharing.length; j++){
								if(folder.items[i].sharing[j].email == email){
									found_flag = true;
								}
							}
							if(found_flag){
								return res.status(400).json({message: 'You have already shared this resource with ' + email});
							} else if (!found_flag){
								folder.items[i].sharing.push({email: user_[0].email, _id: user_[0]._id});
							}
						}
						
					}

						const finalUser = new Users(user[0]);
						console.log(finalUser);
						return finalUser.save().then(()=> res.json(folder));
				}
			});
			} 
		})
	} else {
		return res.json({error: "owner_id '" + owner_id + "' is invalid."});
	}

});

function generate_s3_token(user_id){

	const sts = new AWS.STS();
   
	const policy = 
	{
		"Version": "2012-10-17",
		"Statement": [
			{
				"Effect": "Allow",
				"Action": "*",
				"Resource": [
					"arn:aws:s3:::maxdrive/" + user_id,
					"arn:aws:s3:::maxdrive/" + user_id + "/*"
				]
			}
		]
	};

	const role = {
		DurationSeconds: 1800,
		Name: "STS",
		Policy: JSON.stringify(policy)
	}

	return new Promise(function(resolve, reject){

		sts.getFederationToken(role, (err, data) => {
			if(err) reject(err);
			else resolve(data)
		});

	})

}

app.listen(8000, () => console.log('Server running on http://localhost:8000/'));

module.exports = app;