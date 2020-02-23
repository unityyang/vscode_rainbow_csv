var rbql_running = false;

var handshake_completed = false;

var query_history = [];
var autosuggest_header_vars = [];

const vscode = acquireVsCodeApi();

const normal_table_border = '1px solid rgb(130, 6, 219)';
const header_table_border = '1px solid red';

var last_preview_message = null;

var active_suggest_idx = null;
var suggest_list = [];


function report_backend_language_change() {
    let backend_language = document.getElementById('select_backend_language').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_backend_language', 'value': backend_language});
}


function report_encoding_change() {
    let encoding = document.getElementById('select_encoding').value;
    vscode.postMessage({'msg_type': 'global_param_change', 'key': 'rbql_encoding', 'value': encoding});
}


function report_rfc_fields_policy_change() {
    let enable_rfc_newlines = document.getElementById('enable_rfc_newlines').checked;
    vscode.postMessage({'msg_type': 'newlines_policy_change', 'enable_rfc_newlines': enable_rfc_newlines});
}


function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}


function get_max_num_columns(records) {
    let max_num_columns = 0;
    for (let r = 0; r < records.length; r++) {
        max_num_columns = Math.max(max_num_columns, records[r].length);
    }
    return max_num_columns;
}


function make_header_index_row(num_columns) {
    let result = [];
    result.push('NR');
    for (let i = 0; i < num_columns; i++) {
        result.push(`a${i + 1}`);
    }
    return result;
}


function add_header_row(max_num_columns, table) {
    let header_index_row = make_header_index_row(max_num_columns);
    let row_elem = document.createElement('tr');
    for (let value of header_index_row) {
        let cell = document.createElement('td');
        cell.style.border = header_table_border;
        cell.style.color = '#FF6868';
        cell.style.fontWeight = 'bold';
        cell.textContent = value;
        row_elem.appendChild(cell);
    }
    table.appendChild(row_elem);
}


function make_data_cell(cell_text, border_style) {
    let cell = document.createElement('td');
    cell.style.border = border_style;
    const trim_marker = '###UI_STRING_TRIM_MARKER###';
    let add_ellipsis = false;
    if (cell_text.endsWith(trim_marker)) {
        cell_text = cell_text.substr(0, cell_text.length - trim_marker.length);
        add_ellipsis = true;
    }
    let field_rfc_lines = cell_text.split('\n');
    for (let i = 0; i < field_rfc_lines.length; i++) {
        let span = document.createElement('span');
        span.textContent = field_rfc_lines[i];
        cell.appendChild(span);
        if (i + 1 < field_rfc_lines.length) {
            let newline_span = document.createElement('span');
            newline_span.textContent = '\\n';
            newline_span.style.color = 'yellow';
            newline_span.title = 'new line';
            cell.appendChild(newline_span);
        }
    }
    if (add_ellipsis) {
        let ellipsis_span = document.createElement('span');
        ellipsis_span.style.color = 'yellow';
        ellipsis_span.textContent = ' ...';
        ellipsis_span.title = 'value too long to display';
        cell.appendChild(ellipsis_span);
    }
    return cell;
}


function make_nr_cell(cell_text) {
    let nr_cell = document.createElement('td');
    nr_cell.style.border = header_table_border;
    nr_cell.textContent = cell_text;
    return nr_cell;
}


function make_preview_table() {
    if (!last_preview_message)
        return;
    let records = last_preview_message.preview_records;
    let start_record_zero_based = last_preview_message.start_record_zero_based;
    let preview_error = last_preview_message.preview_sampling_error;

    var table = document.getElementById('preview_table');
    remove_children(table);
    if (preview_error) {
        let row = document.createElement('tr');
        table.appendChild(row);
        let span = document.createElement('span');
        span.style.color = '#FF6868';
        span.textContent = 'Unable to display preview table and run RBQL query:';
        row.appendChild(span);
        row.appendChild(document.createElement('br'));
        span = document.createElement('span');
        span.style.color = '#FF6868';
        span.textContent = preview_error;
        row.appendChild(span);
        return;
    }

    let skip_headers = document.getElementById('skip_headers').checked;
    let max_num_columns = get_max_num_columns(records);
    add_header_row(max_num_columns, table);
    for (var r = 0; r < records.length; r++) {
        let row = document.createElement('tr');
        let NR = r + start_record_zero_based + 1;
        if (skip_headers)
            NR -= 1;
        let nr_text = NR > 0 ? String(NR) : '';
        row.appendChild(make_nr_cell(nr_text));
        for (var nf = 0; nf < records[r].length; nf++) {
            let border_style = NR > 0 ? normal_table_border : header_table_border;
            row.appendChild(make_data_cell(records[r][nf], border_style));
        }
        table.appendChild(row);
    }
}


function navigate_preview(direction) {
    vscode.postMessage({'msg_type': 'navigate', 'direction': direction});
}


function preview_up() {
    navigate_preview('up');
}


function preview_down() {
    navigate_preview('down');
}


function preview_begin() {
    navigate_preview('begin');
}


function preview_end() {
    navigate_preview('end');
}


function process_skip_header_change() {
    let skip_headers = document.getElementById('skip_headers').checked;
    vscode.postMessage({'msg_type': 'skip_headers_change', 'skip_headers': skip_headers}); // We need to send it to remember preview state
    make_preview_table();
}


function show_error(error_type, error_msg) {
    error_msg = error_msg.replace('\r?\n', '\r\n');
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_msg;
    document.getElementById('rbql_error_message').style.display = 'block';
}


function hide_error_msg() {
    document.getElementById('rbql_error_message').style.display = 'none';
}


function toggle_help_msg() {
    let document_bg_color = window.getComputedStyle(document.body).getPropertyValue("background-color");
    let rbql_help_element = document.getElementById('rbql_help');
    var style_before = rbql_help_element.style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    if (new_style == 'block')
        rbql_help_element.style.backgroundColor = document_bg_color;
    rbql_help_element.style.display = new_style;
    document.getElementById('close_help').style.display = new_style;
}


function get_coordinates(elem) {
    // Taken from here: https://javascript.info/coordinates
    let box = elem.getBoundingClientRect();
    return {top: box.top + window.pageYOffset, left: box.left + window.pageXOffset};
}


function register_history_callback(button_element, query) {
    button_element.addEventListener("click", () => { document.getElementById('rbql_input').value = query; });
}


function toggle_history() {
    let query_history_block = document.getElementById('query_history');
    var style_before = query_history_block.style.display;
    var new_style = style_before == 'block' ? 'none' : 'block';
    if (new_style == 'block') {
        document.getElementById('toggle_history_btn').textContent = '\u25BC';
    } else {
        document.getElementById('toggle_history_btn').textContent = '\u25B2';
    }
    let history_entries_block = document.getElementById('history_entries');
    remove_children(history_entries_block);
    for (let nr = 0; nr < query_history.length; nr++) {
        let entry_button = document.createElement('button');
        entry_button.className = 'history_button';
        entry_button.textContent = query_history[nr];
        register_history_callback(entry_button, query_history[nr]);
        history_entries_block.appendChild(entry_button);
    }
    query_history_block.style.display = new_style;
    let calculated_height = query_history_block.scrollHeight;
    let text_input_coordinates = get_coordinates(document.getElementById('rbql_input'));
    query_history_block.style.left = text_input_coordinates.left + 'px';
    query_history_block.style.top = (text_input_coordinates.top - calculated_height) + 'px';
}


function start_rbql() {
    var rbql_text = document.getElementById('rbql_input').value;
    if (!rbql_text || rbql_running)
        return;
    rbql_running = true;
    document.getElementById('status_label').textContent = "Running...";
    let backend_language = document.getElementById('select_backend_language').value;
    let output_format = document.getElementById('select_output_format').value;
    let encoding = document.getElementById('select_encoding').value;
    let enable_rfc_newlines = document.getElementById('enable_rfc_newlines').checked;
    let skip_headers = document.getElementById('skip_headers').checked;
    vscode.postMessage({'msg_type': 'run', 'query': rbql_text, 'backend_language': backend_language, 'output_dialect': output_format, 'encoding': encoding, 'enable_rfc_newlines': enable_rfc_newlines, 'skip_headers': skip_headers});
}


function js_string_escape_column_name(column_name, quote_char) {
    column_name = column_name.replace(/\\/g, '\\\\');
    column_name = column_name.replace(/\n/g, '\\n');
    column_name = column_name.replace(/\r/g, '\\r');
    column_name = column_name.replace(/\t/g, '\\t');
    if (quote_char === "'")
        return column_name.replace(/'/g, "\\'");
    if (quote_char === '"')
        return column_name.replace(/"/g, '\\"');
    return column_name.replace(/`/g, "\\`");
}


function generate_autosuggest_variables(header) {
    let result = [];
    for (let h of header) {
        if (h.match('^[_a-zA-Z][_a-zA-Z0-9]*$') !== null) {
            result.push(`a.${h}`);
        }
        let escaped_column_name = js_string_escape_column_name(h, '"');
        result.push(`a["${escaped_column_name}"]`);
        escaped_column_name = js_string_escape_column_name(h, "'");
        result.push(`a['${escaped_column_name}']`);
    }
    return result;
}


function handle_message(msg_event) {
    var message = msg_event.data;
    console.log('message received at client: ' + JSON.stringify(msg_event));
    let message_type = message['msg_type'];

    if (message_type == 'handshake') {
        if (handshake_completed)
            return;
        handshake_completed = true;
        if (message.hasOwnProperty('last_query')) {
            document.getElementById('rbql_input').value = message['last_query'];
        }
        if (message.hasOwnProperty('query_history')) {
            query_history = message['query_history'];
        }
        let header = message['header'];
        autosuggest_header_vars = generate_autosuggest_variables(header);
        let enable_rfc_newlines = message['enable_rfc_newlines'];
        let skip_headers = message['skip_headers'];
        last_preview_message = message;
        document.getElementById("select_backend_language").value = message['backend_language'];
        document.getElementById("select_encoding").value = message['encoding'];
        document.getElementById("enable_rfc_newlines").checked = enable_rfc_newlines;
        document.getElementById("skip_headers").checked = skip_headers;
        if (message['policy'] == 'quoted') {
            document.getElementById('enable_rfc_newlines_section').style.display = 'block';
        }
        make_preview_table();
    }

    if (message_type == 'navigate' || message_type == 'resample') {
        last_preview_message = message;
        make_preview_table();
    }

    if (message_type == 'rbql_report') {
        rbql_running = false;
        if (message.hasOwnProperty('error_type') || message.hasOwnProperty('error_msg')) {
            let error_type = message.hasOwnProperty('error_type') ? message['error_type'] : 'Unexpected';
            let error_msg = message.hasOwnProperty('error_msg') ? message['error_msg'] : 'Unknown Error';
            show_error(error_type, error_msg);
        }
        document.getElementById('status_label').textContent = "";
    }
}



function apply_suggest(suggest_index) {
    try {
        let rbql_input = document.getElementById('rbql_input');
        rbql_input.value = suggest_list[suggest_index][0];
        rbql_input.selectionStart = suggest_list[suggest_index][1];
        rbql_input.selectionEnd = suggest_list[suggest_index][1];
        rbql_input.focus();
        vscode.postMessage({'msg_type': 'update_query', 'query': suggest_list[suggest_index][0]});
        hide_suggest(document.getElementById('query_suggest'));
    } catch (e) {
        console.error(`Autocomplete error: ${e}`);
    }
}



function register_suggest_callback(button_element, suggest_index) {
    button_element.addEventListener("click", () => {
        apply_suggest(suggest_index);
    });
}


function show_suggest(suggest_div, query_before_var, relevant_suggest_list, query_after_cursor) {
    let rbql_input = document.getElementById('rbql_input');
    let text_input_coordinates = get_coordinates(rbql_input);
    let caret_left_shift = 0;
    try {
        let caret_coordinates = getCaretCoordinates(rbql_input, rbql_input.selectionStart);
        caret_left_shift = caret_coordinates.left ? caret_coordinates.left : 0;
    } catch (e) {
        caret_left_shift = 0;
    }
    remove_children(suggest_div);
    active_suggest_idx = 0;
    suggest_list = [];
    for (let i = 0; i < relevant_suggest_list.length; i++) {
        let suggest_text = relevant_suggest_list[i];
        let entry_button = document.createElement('button');
        entry_button.className = 'history_button';
        entry_button.textContent = suggest_text;
        entry_button.setAttribute('id', `rbql_suggest_var_${i}`);
        register_suggest_callback(entry_button, i);
        suggest_div.appendChild(entry_button);
        suggest_list.push([query_before_var + suggest_text + query_after_cursor, (query_before_var + suggest_text).length]);
    }
    highlight_suggest_entry(active_suggest_idx, true);
    suggest_div.style.display = 'block';
    let calculated_height = suggest_div.scrollHeight;
    suggest_div.style.left = (text_input_coordinates.left + caret_left_shift) + 'px';
    suggest_div.style.top = (text_input_coordinates.top - calculated_height) + 'px';
}


function hide_suggest(suggest_div) {
    if (active_suggest_idx !== null) {
        suggest_div.style.display = 'none';
        active_suggest_idx = null;
        suggest_list = [];
    }
}


function highlight_suggest_entry(suggest_idx, do_highlight) {
    let entry_button = document.getElementById(`rbql_suggest_var_${suggest_idx}`);
    if (!entry_button)
        return;
    if (do_highlight) {
        entry_button.className = 'history_button history_button_active';
    } else {
        entry_button.className = 'history_button';
    }
}


function switch_active_suggest(direction) {
    if (active_suggest_idx === null)
        return false;
    highlight_suggest_entry(active_suggest_idx, false);
    if (direction == 'up') {
        active_suggest_idx = (active_suggest_idx + suggest_list.length - 1) % suggest_list.length;
    } else {
        active_suggest_idx = (active_suggest_idx + 1) % suggest_list.length;
    }
    highlight_suggest_entry(active_suggest_idx, true);
    return true;
}


function handle_input_keydown(event) {
    // We need this logic to prevent the caret from going to the start of the input field with the default arrow-up keydown handler
    try {
        if (event.keyCode == 38) {
            if (switch_active_suggest('up'))
                event.preventDefault();
        } else if (event.keyCode == 40) {
            if (switch_active_suggest('down'))
                event.preventDefault();
        } else if (event.keyCode == 39) {
            if (active_suggest_idx !== null) {
                apply_suggest(active_suggest_idx);
                event.preventDefault();
            }
        }
    } catch (e) {
        console.error(`Autocomplete error: ${e}`);
    }
}


function is_printable_key_code(keycode) {
    // Taken from here: https://stackoverflow.com/a/12467610/2898283
    return (keycode > 47 && keycode < 58) || keycode == 32 || (keycode > 64 && keycode < 91) || (keycode > 185 && keycode < 193) || (keycode > 218 && keycode < 223);
}


function handle_input_keyup(event) {
    event.preventDefault();
    if (event.keyCode == 13) {
        if (active_suggest_idx === null) {
            start_rbql();
        } else {
            apply_suggest(active_suggest_idx);
        }
        return;
    }
    if (is_printable_key_code(event.keyCode) || event.keyCode == 8 /* Bakspace */) {
        // We can't move this into the keydown handler because the characters appear in the input box only after keyUp event.
        // Or alternatively we could scan the event.keyCode to find out the next char, but this is additional logic
        let rbql_input = document.getElementById('rbql_input');
        let current_query = rbql_input.value;
        try {
            let suggest_div = document.getElementById('query_suggest');
            hide_suggest(suggest_div);
            let cursor_pos = rbql_input.selectionStart;
            let query_before_cursor = current_query.substr(0, cursor_pos);
            let query_after_cursor = current_query.substr(cursor_pos);
            let last_var_prefix_match = query_before_cursor.match(/(?:[^_a-zA-Z0-9])([ab](?:\.[_a-zA-Z0-9]*|\[[^\]]*))$/);
            if (last_var_prefix_match) {
                let relevant_suggest_list = [];
                let last_var_prefix = last_var_prefix_match[1];
                let query_before_var = query_before_cursor.substr(0, last_var_prefix_match.index + 1);
                for (let hv of autosuggest_header_vars) {
                    if (last_var_prefix === 'a[' && hv.startsWith('a["'))
                        continue; // Don't match both a['...'] and a["..."] notations of the same variable
                    if (hv.toLowerCase().startsWith(last_var_prefix.toLowerCase()) && hv != last_var_prefix)
                        relevant_suggest_list.push(hv);
                }
                if (relevant_suggest_list.length) {
                    show_suggest(suggest_div, query_before_var, relevant_suggest_list, query_after_cursor);
                }
            }
        } catch (e) {
            console.error(`Autocomplete error: ${e}`);
        }
        vscode.postMessage({'msg_type': 'update_query', 'query': current_query});
    }
}


function main() {
    window.addEventListener('message', handle_message);
    vscode.postMessage({'msg_type': 'handshake'});

    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("select_backend_language").addEventListener("change", report_backend_language_change);
    document.getElementById("select_encoding").addEventListener("change", report_encoding_change);
    document.getElementById("enable_rfc_newlines").addEventListener("click", report_rfc_fields_policy_change);
    document.getElementById("skip_headers").addEventListener("click", process_skip_header_change);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("help_btn").addEventListener("click", toggle_help_msg);
    document.getElementById("close_help").addEventListener("click", toggle_help_msg);
    document.getElementById("toggle_history_btn").addEventListener("click", toggle_history);
    document.getElementById("go_begin").addEventListener("click", preview_begin);
    document.getElementById("go_up").addEventListener("click", preview_up);
    document.getElementById("go_down").addEventListener("click", preview_down);
    document.getElementById("go_end").addEventListener("click", preview_end);
    document.getElementById("rbql_input").addEventListener("keyup", handle_input_keyup);
    document.getElementById("rbql_input").addEventListener("keydown", handle_input_keydown);
    document.getElementById("rbql_input").focus();
}


document.addEventListener("DOMContentLoaded", function(_event) {
    main();
});
