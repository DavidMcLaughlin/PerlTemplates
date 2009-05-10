
/*
 *  PerlTemplates, takes a HTML::Template and parses it on the client-side 
 *
 *
 *  Supports: <tmpl_var name="name" escape="html|url">
 *            <tmpl_if name="condition"> <tmpl_else> </tmpl_if>
 *            <tmpl_unless name="condition"> <tmpl_else> </tmpl_unless>
 *            <tmpl_loop name="loop"><tmpl_var name="var" escape="html|url"></tmpl_loop> 
 *            <tmpl_include name="partial-template.tmpl">
 *
 *
 *
 *  The usage here should be:
 * 
 *     var myTemplate = new PerlTemplates({template:the_template_string, data: json_data, target: 'target_div_for_content'});
 *     myTemplate.render();
 *     
 *  If you need to update the template with new data (via an AJAX request for example) then don't repeat the above process, use:
 *  
 *     myTemplate.render(new_data);
 *
 *  This way you don't have to parse the HTML::Template file again - the template is cached after the first time.  
 *
 *
 *
 *  If you want more control over the rendering process then use it like this:
 *
 *     var template = new PerlTemplates({url:'path/to/template.tmpl', data: your_data_obj});
 *     var content = template.get_content();
 * 
 *  And as above, if you need to update an already parsed template then just call the same function with the new data:
 *
 *     content = template.get_content(new_data);
 *
 *  @author: David McLaughlin <david@dmclaughlin.com>
 */

PerlTemplates = function(options)
{
    if(options.template)
    {
        this.template = this.clean_template(options.template);
    }
    else if(options.url)
    {
        this.template = this.clean_template(PerlTemplates.doRequest(options.url));
    }
    
    if(!this.template)
    {
        throw new Error('No template supplied.');
    }
    this.target = options.target;

    if(options.data)
    {
        this.data = options.data;    
    }
    
    this.parse();
};

/*
 *  Pre-processing to handle some common spanner in the works
 */
PerlTemplates.prototype.clean_template = function(template)
{
    template = template.replace(/\r\n/g, "\n");    
    template = template.replace(/\r/g, "\n");     
    return template;
};

/*
 *  Convenience function called from within the (parsed) template
 */
PerlTemplates.clean = function(content)
{
    content = content.replace(/\\/g, '\\\\');
    content = content.replace(/\n/g, '\\n');
    content = content.replace(/\"/g,  '\\"');
    return content;
};

/*
 *  The magic! Here we dynamically create a process function for this instance which caches the results
 *  of the template compilation using the lexical analyser. That doesn't have to make sense!
 */
PerlTemplates.prototype.parse = function()
{
    var lexer = new PerlTemplates.Lexer(this.template, this.data);           
    var raw_process_function = ' this.process = function() { var data = this.data; ' + lexer.create_output() + ' }; ';    
    eval(raw_process_function);       
};

/*
 *  Returns a data-parsed template as a string, so you can control how it is rendered to the page yourself
 */
PerlTemplates.prototype.get_content = function(data)
{
    if(data)
    {
        this.data = data;
    }    
    return this.process();  
};

/*
 *  Processes the template with the current data set (optionally over-riding it with the data parameter)
 *  and renders it to the target div
 */
PerlTemplates.prototype.render = function(data)
{
    if(data)
    {
        this.data = data;
    }
    
    if(this.target)
    {
        document.getElementById(this.target).innerHTML = this.process();
    }
};


/* 
 * This is a quick and simple SYNCHRONOUS request for the template file
 */
PerlTemplates.Request = function()
{
   var factories = [function() { return new ActiveXObject("Msxml2.XMLHTTP"); },function() { return new XMLHttpRequest(); },function() { return new ActiveXObject("Microsoft.XMLHTTP"); }];
   for(var i = 0; i < factories.length; i++) {
        try {
            var request = factories[i]();
            if (request != null)  return request;
        }
        catch(e) { continue;}
   }
};	

PerlTemplates.doRequest = function(template)
{
   var request = new PerlTemplates.Request();
   request.open("GET", template, false);
   
   try{request.send(null);}
   catch(e){return null;}
   
   if ( request.status == 404 || request.status == 2 ||(request.status == 0 && request.responseText == '') ) return null;
   
   return request.responseText;
};


/*
 *   PerlTemplates Lexer
 *
 *   Does most of the work
 */

PerlTemplates.Lexer = function(template, data)
{
    this.template    = template;
    this.data        = data; // for tmpl_include
    this.tokenreg    = new RegExp("<tmpl_([a-z]+)[\\s]+(?:name=)?[\"]?([a-zA-Z0-9_\\-\\.]+)[\"]?[\\s]*(?:escape=[\"]?(url|html)[\"]?)?[\\s]*>|<(\/)tmpl_([a-zA-Z]+)>|<tmpl_(else)>|<tmpl_(unless)>", "im"); 
    this.loop_depth  = 0;
    this.scope       = ["this", "data"]; // default scope
};

PerlTemplates.Lexer.prototype.create_output = function()
{
    this.output_func  = ' var __templateOUT = ""; ';
    this.analyse();
    this.output_func += ' return __templateOUT; ';
    return this.output_func;
};

PerlTemplates.Lexer.prototype.analyse = function()
{
    // Split the template into lines
    var lines = this.tokenize(this.template, /\n/);

    // For each line    
    for(var i = 0; i < lines.length; i++)
    {
        // tokenize...
        var tokens = this.tokenize(lines[i], this.tokenreg);
        for(var j = 0; j < tokens.length; j++)
        {            
            this.parse_token(tokens[j]);   
        }        
    } 
};

    
PerlTemplates.Lexer.prototype.tokenize = function(item, regex)
{
    var result = regex.exec(item);
    
    // Friendly regex match indices
    var tag_type = 1;
    var tag_name = 2;
    var escaped = 3;
    var closing_tag = 4;
    var closing_tag_type = 5;
    var else_tag = 6;    
    var unless_tag = 7;    
        
    var tokens = new Array();
    
    // while we have a match
    while (result != null)
    {
        var start = result.index;
        // the first token that matches isn't at the start, so process the non-token first
        if ((start) != 0)
        {
            tokens.push(item.substring(0,start));
            item = item.slice(start);
        }
        // matches <tmpl_* name=*> with optional escape=html|url parameter
        if(result[tag_type] && result[tag_name])
        {
            var escape = result[escaped] ? result[escaped] : false;
            tokens.push({type: result[tag_type], value: result[tag_name], escape: escape });
        }
        // matches </tmpl_*>
        else if(result[closing_tag] && result[closing_tag_type])
        {
            tokens.push({close: result[closing_tag_type]});
        }
        // matches <tmpl_else>
        else if(result[else_tag])
        {
            tokens.push({type: 'else'});
        }
        // matches <tmpl_unless>
        else if(result[unless_tag])
        {
            tokens.push({type: 'unless'});
        }
        // a non-token
        else
        {
            tokens.push(result[0]);       
        }       
        item = item.slice(result[0].length);
        result = regex.exec(item);             
    }
    // process anything remaining in our string
    if (! item == '')
    {
        tokens.push(item);
    }
    return tokens;    
};

PerlTemplates.Lexer.prototype.parse_token = function(token)
{    
    // Not a HTML::Template tag, so we don't care.. just spit it back out
    if(typeof token == 'string')
    {
        this.output_func += ' __templateOUT += "' + PerlTemplates.clean(token) + '";';
    }
    else // We have a HTML::Template token!
    {
        // case insensitive matching
        if(token.type)   {  token.type   = token.type.toLowerCase();   }
        if(token.escape) {  token.escape = token.escape.toLowerCase(); }
        if(token.close)  {  token.close  = token.close.toLowerCase();  }
        
       // tmpl_var tag
        if(token.type == 'var')
        {
            if(token.escape)
            {
                if(token.escape == 'html')
                {
                    this.output_func += ' __templateOUT += escape(' + this.get_scope() + token.value + ');';
                }
                else
                {
                    this.output_func += ' __templateOUT += encodeURI(' + this.get_scope() + token.value + ');';
                }
            }
            else
            {
                this.output_func += ' __templateOUT += ' + this.get_scope() + token.value + ';';
            }
        }
        // tmpl_include
        else if(token.type == 'include')
        {
            // TODO: relative paths for token.value
            var template_url = token.value;
            
            this.output_func += ' __templateOUT += "' + new PerlTemplates({url: token.value, data: this.data}).get_content() + '";';
        }
        // tmpl_if
        else if(token.type == 'if')
        {
            var v = this.get_scope() + token.value;
            // if( ( val instanceof Array && val.length > 0) || (!(val instance of Array) && val) )
            this.output_func += ' if( (' + v + ' instanceof Array && ' + v + '.length > 0) || (!(' + v + ' instanceof Array) && ' + v + ')) { ';
        }  
        // tmpl_unless
        else if(token.type == 'unless')
        {
            this.output_func += ' if(!' + this.get_scope() + token.value + ') { ';
        }
        // tmpl_else tag
        else if(token.type == 'else')
        {
            this.output_func += ' } else { ';
        }
        // tmpl_loop tag
        else if(token.type == 'loop')
        {
            this.loop_depth++;
            this.output_func += this.create_loop_str(token);
            
            // we're entering a for loop, need to adjust the scope!
            this.scope.push(token.value);
        }
        // </tmpl_*>
        else if(token.close)
        {
            if(token.close == 'loop')
            {
                this.loop_depth--;
                this.scope.pop();
            }
            this.output_func += ' } ';
        }
    
    }
};
    
PerlTemplates.Lexer.prototype.get_scope = function()
{
    // default scope every time: 'this.data.'
    var final_scope = this.scope.slice(0,2).join('.') + '.';
    
    // If this is a nested loop then we need to apply loop keys
    if(this.scope.length > 2)
    {
        // remove the default scope
        var loops = this.scope.slice(2, this.scope.length);
        for(var i = 0; i < loops.length; i++)
        {
            // this.data.nested_loop[i1].second_nested_loop[i2]. ..etc.
            final_scope += loops[i] + '[i' + (i+1) + '].';
        }        
    } 
   
    return final_scope;    
};

PerlTemplates.Lexer.prototype.create_loop_str = function(token)
{
    // for(iX = 0; iX < loop.length; iX++) {
    return ' for(i' + this.loop_depth + ' = 0; i' + this.loop_depth + ' < ' + this.get_scope() + token.value + '.length; i' + this.loop_depth + '++) { ';
};