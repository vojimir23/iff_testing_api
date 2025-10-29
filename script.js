const API_BASE_URL = "https://preumbonal-manually-zita.ngrok-free.dev";
let availableOptions = {};
let itemPagesData = {};
let currentQueryForRendering = {};

const relationshipLabelMap = new Map();
Object.values(relationshipMappings).forEach(entityRelations => {
    entityRelations.forEach(relation => {
        relationshipLabelMap.set(relation.name, relation.label);
    });
});
const entityTypeToCssClass = {
    'work': 'entity-tag-work',
    'expression': 'entity-tag-expression',
    'manifestation': 'entity-tag-manifestation',
    'manifestation_volume': 'entity-tag-manifestation-volume', // NEW
    'item': 'entity-tag-item',
    'page': 'entity-tag-page',
    'visual_object': 'entity-tag-visual_object',
    'physical_object': 'entity-tag-physical_object',
    'person': 'entity-tag-person',
    'institution': 'entity-tag-institution',
    'event': 'entity-tag-event',
    'abstract_character': 'entity-tag-abstract_character',
    'place': 'entity-tag-place',
    'hypothesis': 'entity-tag-hypothesis'
};


function linkify(text) {
    if (typeof text !== 'string' || !text) return text;
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return text.replace(urlRegex, function(url) {
        const href = url.startsWith('www.') ? 'http://' + url : url;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

// --- MODIFICATION START: New helper function to render person details ---
function renderPersonDetails(person) {
    if (!person) return '';
    // Check if it's a person object by looking for specific keys
    if (!person.name && !person.person_name) return '';

    const parts = [
        person.birth_date,
        person.birth_date_notes,
        person.death_date,
        person.death_date_notes
    ].filter(Boolean); // Filter out null/undefined/empty strings

    if (parts.length === 0) return '';

    // Use a smaller, muted style for the details
    return `<span style="font-size: 0.8em; color: #6c757d; display: block; margin-top: -2px;">(${parts.join(' - ')})</span>`;
}
// --- MODIFICATION END ---

function renderHypothesisTags(entity) {
    if (!entity.hypotheses || entity.hypotheses.length === 0) {
        return '';
    }
    const tagsHTML = entity.hypotheses.map(hypo => {
        return `<div class="hypothesis-tag" data-hypothesis-id="${hypo.hypothesis_id}" title="${hypo.hypothesis_title}">
            Hypothesis from ${hypo.creator_name}
        </div>`;
    }).join('');
    return `<div class="hypothesis-tags-container">${tagsHTML}</div>`;
}

async function buildQueryAndFetch() {
    const query = {
        projects: [],
        entity: document.getElementById('entity-select').value,
        rules: []
    };

    const projectSelect = document.getElementById('project-select');
    if (projectSelect) {
        query.projects = Array.from(projectSelect.querySelectorAll('input[type="checkbox"]:checked'))
                            .map(cb => cb.value)
                            .filter(val => val !== '__SELECT_ALL__');
    }

    document.querySelectorAll('.filter-row.sub-row').forEach(row => {
        const field = row.querySelector('.field-select')?.value;
        const logic = row.querySelector('.logic-selector .active')?.dataset.logic;
        const multiselect = row.querySelector('.custom-multiselect');
        const dateFilter = row.querySelector('.date-filter-container');
        const authorshipSearchFilter = row.querySelector('.authorship-search-container');
        const manifestationRoleFilter = row.querySelector('.manifestation-role-container');

        if (field && logic && multiselect && !dateFilter && !authorshipSearchFilter && !manifestationRoleFilter) {
            const checkedInputs = multiselect.querySelectorAll('input[type="checkbox"]:checked');
            checkedInputs.forEach(input => {
                if (input.value !== '__SELECT_ALL__') {
                    const ruleValue = input.value;
                    const backendField = (field === 'role') ? 'role_of_person_or_institution' : field;
                    query.rules.push({ field: backendField, logic, value: ruleValue, op: 'equals' });
                }
            });
        } 
        else if (field === 'publication_date' && dateFilter) {
            const fromVal = dateFilter.querySelector('.date-from').value;
            const toVal = dateFilter.querySelector('.date-to').value;
            if (fromVal) {
                query.rules.push({ field: 'publication_date', logic: 'gte', value: fromVal });
            }
            if (toVal) {
                query.rules.push({ field: 'publication_date', logic: 'lte', value: toVal });
            }
        }
        else if (field === 'authorship' && logic && authorshipSearchFilter) {
            const roleSelect = authorshipSearchFilter.querySelector('.authorship-multiselect');
            const personSelect = authorshipSearchFilter.querySelector('.person-multiselect');

            const selectedRoles = Array.from(roleSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
                .filter(val => val !== '__SELECT_ALL__');
            
            const selectedPeople = Array.from(personSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
                .filter(val => val !== '__SELECT_ALL__' && val !== '__EMPTY__');

            if (selectedRoles.length === 0 && selectedPeople.length > 0) {
                selectedPeople.forEach(person => {
                    query.rules.push({ field: 'author', logic, value: person });
                    query.rules.push({ field: 'secondary_author', logic, value: person });
                });
            } else if (selectedRoles.length > 0 && selectedPeople.length > 0) {
                selectedRoles.forEach(role => {
                    if (role === 'Author') {
                        selectedPeople.forEach(person => query.rules.push({ field: 'author', logic, value: person }));
                    } else if (role === 'Secondary author') {
                        selectedPeople.forEach(person => query.rules.push({ field: 'secondary_author', logic, value: person }));
                    }
                });
            }
        }
        else if (field === 'manifestation_role' && logic && manifestationRoleFilter) {
            const roleSelect = manifestationRoleFilter.querySelector('.manifestation-role-multiselect');
            const personInstSelect = manifestationRoleFilter.querySelector('.person-institution-multiselect');

            const selectedRoles = Array.from(roleSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value.toLowerCase())
                .filter(val => val !== '__select_all__');
            
            const selectedPeopleAndInst = Array.from(personInstSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
                .filter(val => val !== '__SELECT_ALL__' && val !== '__EMPTY__');

            if (selectedRoles.length > 0 && selectedPeopleAndInst.length > 0) {
                selectedRoles.forEach(roleField => {
                    selectedPeopleAndInst.forEach(personOrInst => {
                        query.rules.push({ field: roleField, logic, value: personOrInst });
                    });
                });
            }
        }
        else if (field === 'visual_object_role' && logic && row.querySelector('.manifestation-role-container')) {
            const roleSelect = row.querySelector('.visual-object-role-multiselect');
            const personInstSelect = row.querySelector('.person-institution-vo-multiselect');

            const selectedRoles = Array.from(roleSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
                .filter(val => val !== '__SELECT_ALL__');
            
            const selectedPeopleAndInst = Array.from(personInstSelect.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value)
                .filter(val => val !== '__SELECT_ALL__' && val !== '__EMPTY__');

            const roleToFieldMap = {
                'Owner': 'visual_object_owner',
                'Inscriber': 'visual_object_inscriber',
                'Sender': 'visual_object_sender',
                'Recipient': 'visual_object_recipient'
            };

            if (selectedRoles.length > 0 && selectedPeopleAndInst.length > 0) {
                selectedRoles.forEach(role => {
                    const roleField = roleToFieldMap[role];
                    if (roleField) {
                        selectedPeopleAndInst.forEach(personOrInst => {
                            query.rules.push({ field: roleField, logic, value: personOrInst });
                        });
                    }
                });
            }
        }
    });

    document.getElementById('api-endpoint').textContent = `${API_BASE_URL}/entities/search`;
    document.getElementById('api-payload').textContent = JSON.stringify(query, null, 2);
    currentQueryForRendering = query;

    if (query.projects.length === 0 && query.rules.length === 0) {
        document.getElementById('results-content').innerHTML = '<p>Please select at least one project or add a filter to see results.</p>';
        document.getElementById('results-count').textContent = '0';
        return; 
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/entities/search`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(query)
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const responseData = await response.json();
        document.getElementById('results-count').textContent = responseData.count;
        displayResults(responseData.results, query.entity, query);

    } catch (error) {
        document.getElementById('results-content').innerHTML = `<p style="color: red;">Error fetching data: ${error.message}</p>`;
        document.getElementById('results-count').textContent = '0';
    }
}

function renderPageListItems(pages, voRoleRules) {
    if (!pages || pages.length === 0) return '';

    return pages.map(page => {
        let visualObjects = page.visual_objects || [];
        
        if (voRoleRules.length > 0) {
            const andRules = voRoleRules.filter(r => r.logic === 'and');
            const orRules = voRoleRules.filter(r => r.logic === 'or');
            const notRules = voRoleRules.filter(r => r.logic === 'not');

            visualObjects = visualObjects.filter(vo => {
                const roleMap = {
                    'visual_object_owner': vo.owners || [],
                    'visual_object_inscriber': vo.inscribers || [],
                    'visual_object_sender': vo.senders || [],
                    'visual_object_recipient': vo.recipients || []
                };

                const checkMatch = (rule) => {
                    const attributes = roleMap[rule.field] || [];
                    return attributes.includes(rule.value);
                };

                const meetsAnyNots = notRules.some(rule => checkMatch(rule));
                if (meetsAnyNots) {
                    return false;
                }

                const meetsAllAnds = andRules.every(rule => checkMatch(rule));
                const meetsAnyOrs = orRules.some(rule => checkMatch(rule));

                if (andRules.length > 0 && orRules.length > 0) {
                    return meetsAllAnds && meetsAnyOrs;
                }
                if (andRules.length > 0) {
                    return meetsAllAnds;
                }
                if (orRules.length > 0) {
                    return meetsAnyOrs;
                }
                return true;
            });
        }

        if (visualObjects.length === 0) return '';
        
        const voCircles = visualObjects.map((vo, index) => {
            return `<span class="vo-circle" title="${vo.vo_name}" data-vo-id="${vo.vo_id}">${index + 1}</span>`;
        }).join('');

        return `<li>
            <span class="page-toggle">${page.page_label}</span>
            <div class="vo-list" style="display: none;">${voCircles}</div>
        </li>`;

    }).join('');
}

// --- MODIFICATION START: Updated displayResults to use the 'card' key ---
function displayResults(results, entity) {
    const resultsContent = document.getElementById('results-content');
    itemPagesData = {}; 

    if (results.length === 0) {
        resultsContent.innerHTML = '<p>No results match the current filters.</p>';
        return;
    }

    if (entity === 'work') {
        resultsContent.innerHTML = results.map(work => {
            const card = work.card;
            const authorsText = (card.authors && card.authors.length > 0)
                ? card.authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-work">Work</span>
                    <span class="project-tag">${card.project}</span>
                </div>
                <h3 data-work-id="${work.work_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Authors:</strong></p><div>${authorsText}</div>
                <p><strong>Classifications:</strong> ${card.classifications}</p>
                ${renderHypothesisTags(work)}
            </div>`;
        }).join('');
    } else if (entity === 'expression') {
        resultsContent.innerHTML = results.map(exp => {
            const card = exp.card;
            const primaryAuthorsText = (card.primary_authors && card.primary_authors.length > 0)
                ? card.primary_authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            const secondaryAuthorsText = (card.secondary_authors && card.secondary_authors.length > 0)
                ? card.secondary_authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '';
            
            const secondaryAuthorsHTML = secondaryAuthorsText ? `<p><strong>Secondary Authors:</strong></p><div>${secondaryAuthorsText}</div>` : '';
            const responsibilityHTML = card.responsibility ? `<p><strong>Responsibility:</strong> ${card.responsibility}</p>` : '';
            
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-expression">Expression</span>
                    <span class="project-tag">${card.project}</span>
                </div>
                <h3 data-expression-id="${exp.expression_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Authors:</strong></p><div>${primaryAuthorsText}</div>
                ${secondaryAuthorsHTML}
                ${responsibilityHTML}
                <p><strong>Language:</strong> ${card.language || '<em>None</em>'}</p>
                ${renderHypothesisTags(exp)}
            </div>`;
        }).join('');
    } else if (entity === 'manifestation') {
        resultsContent.innerHTML = results.map(man => {
            const card = man.card;
            const publishersText = (card.publishers && card.publishers.length > 0)
                ? card.publishers.map(p => {
                    if (p.type === 'person') {
                        return `<div>${p.name}${renderPersonDetails(p)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${p.id}">${p.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            const placeText = card.place ? card.place.place_name : '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-manifestation">Manifestation</span>
                    <span class="project-tag">${card.project}</span>
                </div>
                <h3 data-manifestation-id="${man.manifestation_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Publisher:</strong></p><div>${publishersText}</div>
                <p><strong>Place:</strong> ${placeText}</p>
                ${renderHypothesisTags(man)}
            </div>`;
        }).join('');
    } else if (entity === 'item') {
        resultsContent.innerHTML = results.map(item => {
            const card = item.card;
            const authorsText = (card.authors && card.authors.length > 0)
                ? card.authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            const physicalObjectHTML = card.physical_object_info ? 
                `<div class="physical-object-tag-container"><span class="physical-object-tag">${card.physical_object_info}</span></div>` : '';
            const annotatedPagesHTML = card.annotated_pages_info ?
                `<div class="annotated-pages-tag-container"><span class="annotated-pages-tag">${card.annotated_pages_info}</span></div>` : '';

            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-item">Item</span>
                    <span class="project-tag">${card.project}</span>
                </div>
                <h3 data-item-id="${item.item_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Authors:</strong></p><div>${authorsText}</div>
                <p><strong>Date:</strong> ${card.date}</p>
                ${physicalObjectHTML}
                ${annotatedPagesHTML}
                ${renderHypothesisTags(item)}
            </div>`;
        }).join('');
    } else if (entity === 'person') {
        resultsContent.innerHTML = results.map(person => {
            const card = person.card;
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-person">Person</span>
                    <span class="project-tag">${card.project}</span>
                </div>
                <h3 data-person-id="${person.person_id}" title="${card.name}">${card.name}</h3>
                ${renderPersonDetails(card)}
                ${renderHypothesisTags(person)}
            </div>`;
        }).join('');
    }
}
// --- MODIFICATION END ---

function addFilterRow(container) {
    const row = document.createElement('div');
    row.className = 'filter-row sub-row';
    row.innerHTML = `
        <select class="field-select"></select>
        <span class="value-placeholder"></span>
        <span class="logic-placeholder"></span>
        <div class="row-controls">
            <button class="remove-row-btn" title="Remove row">-</button>
            <button class="add-row-btn" title="Add new row">+</button>
        </div>
    `;
    container.appendChild(row);
    updateFieldSelector(row.querySelector('.field-select'));
    attachRowEventListeners(row);
}

function createCustomMultiSelect(options, fieldName, config = {}) {
    const selectId = `multiselect-${fieldName}-${Date.now()}`;
    const container = document.createElement('div');
    container.className = 'custom-multiselect';
    if (config.customClass) {
        container.classList.add(config.customClass);
    }
    
    let optionsHTML = '';
    (options || []).forEach(opt => {
        const optionId = `${selectId}-opt-${String(opt).replace(/[^a-zA-Z0-9]/g, '')}`;
        optionsHTML += `
            <li class="multiselect-option">
                <input type="checkbox" id="${optionId}" value="${opt}">
                <label for="${optionId}">${opt}</label>
            </li>`;
    });

    let emptyOptionLabel = config.emptyLabel || "(Has no value)";
    let emptyOptionHTML = `
        <li class="multiselect-option special-option">
            <input type="checkbox" id="${selectId}-empty" value="__EMPTY__">
            <label for="${selectId}-empty">${emptyOptionLabel}</label>
        </li>`;
    
    if (config.hideEmpty) {
        emptyOptionHTML = '';
    }

    container.innerHTML = `
        <div class="multiselect-display" tabindex="0">${config.placeholder || '-- Select Value --'}</div>
        <div class="multiselect-panel">
            <input type="text" class="multiselect-search" placeholder="Search...">
            <ul class="multiselect-options-list">
                <li class="multiselect-option special-option">
                    <input type="checkbox" id="${selectId}-select-all" value="__SELECT_ALL__">
                    <label for="${selectId}-select-all">Select All</label>
                </li>
                ${emptyOptionHTML}
                ${optionsHTML}
            </ul>
        </div>
    `;

    const display = container.querySelector('.multiselect-display');
    const panel = container.querySelector('.multiselect-panel');
    const searchInput = container.querySelector('.multiselect-search');
    const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
    const selectAllCheckbox = container.querySelector(`#${selectId}-select-all`);
    const itemCheckboxes = Array.from(allCheckboxes).filter(cb => cb.value !== '__SELECT_ALL__');

    display.addEventListener('click', () => panel.classList.toggle('visible'));

    searchInput.addEventListener('keyup', () => {
        const filter = searchInput.value.toLowerCase();
        container.querySelectorAll('.multiselect-options-list li').forEach(li => {
            if (li.classList.contains('special-option')) return;
            const label = li.querySelector('label').textContent.toLowerCase();
            li.style.display = label.includes(filter) ? '' : 'none';
        });
    });

    selectAllCheckbox.addEventListener('change', () => {
        const visibleCheckboxes = itemCheckboxes.filter(cb => cb.closest('li').style.display !== 'none');
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
        updateDisplay();
        buildQueryAndFetch();
    });

    itemCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            if (!checkbox.checked) {
                selectAllCheckbox.checked = false;
            }
            updateDisplay();
            buildQueryAndFetch();
        });
    });

    function updateDisplay() {
        const selected = itemCheckboxes.filter(cb => cb.checked);
        if (selected.length === 0) {
            display.textContent = config.placeholder || '-- Select Value --';
        } else if (selected.length === 1) {
            display.textContent = selected[0].closest('li').querySelector('label').textContent;
        } else {
            display.textContent = `${selected.length} items selected`;
        }
    }
    
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            panel.classList.remove('visible');
        }
    });

    return container;
}

function attachRowEventListeners(row) {
    row.querySelector('.add-row-btn').addEventListener('click', () => {
        addFilterRow(document.getElementById('filter-rows-container'));
    });

    row.querySelector('.remove-row-btn').addEventListener('click', () => {
        row.remove();
        buildQueryAndFetch();
    });

    row.querySelector('.field-select').addEventListener('change', (e) => {
        const field = e.target.value;
        const valuePlaceholder = row.querySelector('.value-placeholder');
        const logicPlaceholder = row.querySelector('.logic-placeholder');
        
        valuePlaceholder.innerHTML = '';
        logicPlaceholder.innerHTML = '';

        if (field) {
            const logicSelector = document.createElement('div');
            logicSelector.className = 'logic-selector';
            logicSelector.innerHTML = `
                <button data-logic="and" class="active">AND</button>
                <button data-logic="or">OR</button>
                <button data-logic="not">NOT</button>
            `;
            logicPlaceholder.appendChild(logicSelector);
            logicSelector.addEventListener('click', (btnEvent) => {
                if(btnEvent.target.tagName === 'BUTTON') {
                    logicSelector.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                    btnEvent.target.classList.add('active');
                    buildQueryAndFetch();
                }
            });

            if (field === 'publication_date') {
                const dateRange = availableOptions.publication_date_range || {min: 1500, max: 2025};
                valuePlaceholder.innerHTML = `
                    <div class="date-filter-container">
                        <label>From:</label>
                        <input type="number" class="date-from" placeholder="${dateRange.min}" min="${dateRange.min}" max="${dateRange.max}">
                        <label>To:</label>
                        <input type="number" class="date-to" placeholder="${dateRange.max}" min="${dateRange.min}" max="${dateRange.max}">
                    </div>
                `;
                valuePlaceholder.querySelectorAll('input').forEach(input => {
                    input.addEventListener('change', buildQueryAndFetch);
                });
            } else if (field === 'authorship') {
                const container = document.createElement('div');
                container.className = 'authorship-search-container';
                
                const authorshipSelect = createCustomMultiSelect(['Author', 'Secondary author'], 'authorship', {
                    placeholder: '-- Select Authorship --',
                    hideEmpty: true,
                    customClass: 'authorship-multiselect'
                });
                
                const personSelect = createCustomMultiSelect(availableOptions.all_people, 'person', {
                    placeholder: '-- Select Person(s) --',
                    hideEmpty: true,
                    customClass: 'person-multiselect'
                });

                container.appendChild(authorshipSelect);
                container.appendChild(personSelect);
                valuePlaceholder.appendChild(container);
            } else if (field === 'role') {
                const otherRoles = (availableOptions.expression_roles || []).filter(r => r !== 'Author' && r !== 'Secondary author');
                const roleSelect = createCustomMultiSelect(otherRoles, 'role', {
                    placeholder: '-- Select Role(s) --',
                    hideEmpty: true
                });
                valuePlaceholder.appendChild(roleSelect);
            } else if (field === 'manifestation_role') {
                const container = document.createElement('div');
                container.className = 'manifestation-role-container';
                
                const roleSelect = createCustomMultiSelect(availableOptions.manifestation_roles, 'manifestation_role', {
                    placeholder: '-- Select Role --',
                    hideEmpty: true,
                    customClass: 'manifestation-role-multiselect'
                });
                
                const personInstSelect = createCustomMultiSelect(availableOptions.all_people_and_institutions, 'person_institution', {
                    placeholder: '-- Select Person/Institution --',
                    hideEmpty: true,
                    customClass: 'person-institution-multiselect'
                });

                container.appendChild(roleSelect);
                container.appendChild(personInstSelect);
                valuePlaceholder.appendChild(container);
            } else if (field === 'visual_object_role') {
                const container = document.createElement('div');
                container.className = 'manifestation-role-container';
                
                const roleSelect = createCustomMultiSelect(availableOptions.visual_object_roles, 'visual_object_role', {
                    placeholder: '-- Select Role --',
                    hideEmpty: true,
                    customClass: 'visual-object-role-multiselect'
                });
                
                const personInstSelect = createCustomMultiSelect(availableOptions.all_people_and_institutions, 'person_institution_vo', {
                    placeholder: '-- Select Person/Institution --',
                    hideEmpty: true,
                    customClass: 'person-institution-vo-multiselect'
                });

                container.appendChild(roleSelect);
                container.appendChild(personInstSelect);
                valuePlaceholder.appendChild(container);
            } else {
                const optionsMap = {
                    'author': availableOptions.authors,
                    'classification': availableOptions.classifications,
                    'type_of_expression': availableOptions.types_of_expression,
                    'language': availableOptions.languages,
                    'place': availableOptions.places,
                    'preservation_status': availableOptions.preservation_statuses,
                    'owner': availableOptions.owners,
                    'material': availableOptions.materials,
                    'type_of_item': availableOptions.types_of_item,
                    'work_title': availableOptions.work_titles,
                    'person_name': availableOptions.all_people,
                    'person_role': availableOptions.person_roles, // ADDED
                };
                const configMap = {
                    'author': { hideEmpty: true },
                    'classification': { emptyLabel: 'Unclassified' },
                    'work_title': { hideEmpty: true, placeholder: '-- Select Title(s) --' },
                    'person_name': { hideEmpty: true, placeholder: '-- Select Person(s) --' },
                    'person_role': { hideEmpty: true, placeholder: '-- Select Role(s) --' }, // ADDED
                }
                const options = optionsMap[field];
                const config = configMap[field] || {};
                const customSelect = createCustomMultiSelect(options, field, config);
                valuePlaceholder.appendChild(customSelect);
            }
        }
        buildQueryAndFetch();
    });
}

function updateFieldSelector(selectElement) {
    const currentEntity = document.getElementById('entity-select').value;
    if (currentEntity === 'work') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="classification">Classification</option>
            <option value="author">Author</option>
        `;
    } else if (currentEntity === 'expression') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="authorship">Authorship</option>
            <option value="role">Role</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="classification">Classification of work</option>
        `;
    } else if (currentEntity === 'manifestation') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="classification">Classification of work</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="place">Place</option>
            <option value="publication_date">Date</option>
            <option value="manifestation_role">Role of person or institution</option>
        `;
    } else if (currentEntity === 'item') {
        selectElement.innerHTML = `
        
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="preservation_status">Preservation status</option>
            <option value="owner">Institution or person (owner)</option>
            <option value="material">Material</option>
            <option value="type_of_item">Type of Item</option>
            <option value="visual_object_role">Role of person or institution (Visual Object)</option>
            <option value="classification">Classification of work</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="place">Place</option>
            <option value="publication_date">Date</option>
        `;
    } else if (currentEntity === 'person') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="person_name">Name</option>
            <option value="person_role">Role of the person</option>
        `;
    }
}

function handleEntityChange() {
    document.querySelectorAll('.filter-row.sub-row').forEach(row => row.remove());
    buildQueryAndFetch();
}

function showSearchPage() {
    document.querySelector('.container').style.display = 'block';
    document.getElementById('details-page-container').style.display = 'none';
}

function createEntityLink(id, type, label) {
    if (!id || !type || !label) return linkify(label || '');

    switch (type) {
        case 'person':
            return `<a href="#" class="author-link" data-author-id="${id}">${label}</a>`;
        case 'work':
            return `<a href="#" class="work-link" data-work-id="${id}">${label}</a>`;
        case 'abstract_character':
            return `<a href="#" class="ac-link" data-ac-id="${id}">${label}</a>`;
        case 'expression':
            return `<a href="#" class="expression-link" data-expression-id="${id}">${label}</a>`;
        case 'visual_object':
            return `<a href="#" class="vo-link" data-vo-id="${id}">${label}</a>`;
        case 'manifestation':
            return `<a href="#" class="manifestation-link" data-manifestation-id="${id}">${label}</a>`;
        case 'manifestation_volume': // NEW
            return `<a href="#" class="manifestation-volume-link" data-manifestation-volume-id="${id}">${label}</a>`;
        case 'place':
            return `<a href="#" class="place-link" data-place-id="${id}">${label}</a>`;
        case 'item':
            return `<a href="#" class="item-link" data-item-id="${id}">${label}</a>`;
        case 'institution':
            return `<a href="#" class="institution-link" data-institution-id="${id}">${label}</a>`;
        case 'page':
            return `<a href="#" class="page-link" data-page-id="${id}">${label}</a>`;
        case 'physical_object':
            return `<a href="#" class="physical-object-link" data-physical-object-id="${id}">${label}</a>`;
        case 'hypothesis':
            return `<a href="#" class="hypothesis-link" data-hypothesis-id="${id}">${label}</a>`;
        default:
            return linkify(label);
    }
}

// --- MODIFICATION START: Refactored to make all cards in "Mentioning" sections clickable ---
function renderRelationshipCard(item) {
    const isOutgoing = item.direction === 'outgoing' || item.direction === 'transitive';
    const entityId = isOutgoing ? item.target_id : item.source_id;
    const entityType = isOutgoing ? item.target_type : item.source_type;
    const entityLabel = isOutgoing ? item.target_label : item.source_label;
    const cardData = isOutgoing ? item.target_card : item.source_card;

    if (!cardData) return '';

    const projectTag = cardData.project ? `<span class="project-tag">${cardData.project}</span>` : '';
    let contentHTML = '';
    let title = cardData.title || entityLabel;

    // Map entity types to the data-attribute names used by the click handlers
    const entityTypeToDataAttr = {
        'work': 'data-work-id',
        'expression': 'data-expression-id',
        'manifestation': 'data-manifestation-id',
        'manifestation_volume': 'data-manifestation-volume-id',
        'item': 'data-item-id',
        'page': 'data-page-id',
        'visual_object': 'data-vo-id', // Fix: Ensures correct attribute for click handler
        'physical_object': 'data-physical-object-id',
        'person': 'data-person-id',
        'institution': 'data-institution-id',
        'event': 'data-event-id',
        'abstract_character': 'data-ac-id',
        'place': 'data-place-id',
        'hypothesis': 'data-hypothesis-id'
    };
    const dataAttribute = entityTypeToDataAttr[entityType] 
        ? `${entityTypeToDataAttr[entityType]}="${entityId}"`
        : `data-${entityType.replace(/_/g, '-')}-id="${entityId}"`; // Fallback for safety

    switch (entityType) {
        case 'work':
            const authorsText = (cardData.authors && cardData.authors.length > 0)
                ? cardData.authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Authors:</strong></p><div>${authorsText}</div>
                <p><strong>Classifications:</strong> ${cardData.classifications || '<em>None</em>'}</p>
            `;
            break;
        case 'expression':
            const primaryAuthorsText = (cardData.primary_authors && cardData.primary_authors.length > 0)
                ? cardData.primary_authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            const secondaryAuthorsText = (cardData.secondary_authors && cardData.secondary_authors.length > 0)
                ? cardData.secondary_authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '';
            const secondaryAuthorsHTML = secondaryAuthorsText ? `<p><strong>Secondary Authors:</strong></p><div>${secondaryAuthorsText}</div>` : '';
            const responsibilityHTML = cardData.responsibility ? `<p><strong>Responsibility:</strong> ${cardData.responsibility}</p>` : '';
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Authors:</strong></p><div>${primaryAuthorsText}</div>
                ${secondaryAuthorsHTML}
                ${responsibilityHTML}
                <p><strong>Language:</strong> ${cardData.language || '<em>None</em>'}</p>
            `;
            break;
        case 'manifestation':
        case 'manifestation_volume': // Render volumes the same as manifestations
            const publishersText = (cardData.publishers && cardData.publishers.length > 0)
                ? cardData.publishers.map(p => {
                    if (p.type === 'person') {
                        return `<div>${p.name}${renderPersonDetails(p)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${p.id}">${p.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            const placeText = cardData.place ? cardData.place.place_name : '<em>None</em>';
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Publisher:</strong></p><div>${publishersText}</div>
                <p><strong>Place:</strong> ${placeText}</p>
            `;
            break;
        case 'item':
            const itemAuthorsText = (cardData.authors && cardData.authors.length > 0)
                ? cardData.authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('')
                : '<em>None</em>';
            const physicalObjectHTML = cardData.physical_object_info ? 
                `<div class="physical-object-tag-container"><span class="physical-object-tag">${cardData.physical_object_info}</span></div>` : '';
            const annotatedPagesHTML = cardData.annotated_pages_info ?
                `<div class="annotated-pages-tag-container"><span class="annotated-pages-tag">${cardData.annotated_pages_info}</span></div>` : '';
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Authors:</strong></p><div>${itemAuthorsText}</div>
                <p><strong>Date:</strong> ${cardData.date || '<em>None</em>'}</p>
                ${physicalObjectHTML}
                ${annotatedPagesHTML}
            `;
            break;
        default:
            let defaultContent = `<h3 ${dataAttribute} title="${title || entityLabel}">${title || entityLabel}</h3>`;
            if (entityType === 'person' && cardData) {
                defaultContent += renderPersonDetails(cardData);
            }
            contentHTML = defaultContent;
            break;
    }

    return `
        <div class="result-card">
            <div class="card-header">
                <span class="entity-tag ${entityTypeToCssClass[entityType] || ''}">${entityType.replace(/_/g, ' ')}</span>
                ${projectTag}
            </div>
            ${contentHTML}
            ${renderHypothesisTags(cardData)}
        </div>
    `;
}
// --- MODIFICATION END ---

// --- MODIFICATION START: New function to render a single entity card from details data ---
function renderEntityCardFromDetails(entityDetails) {
    const entityType = entityDetails.type;
    const entityId = entityDetails.id; // Assuming the ID is passed in the details
    const cardData = entityDetails.card;
    const entityLabel = entityDetails.label;

    if (!cardData) return '';

    const projectTag = cardData.project ? `<span class="project-tag">${cardData.project}</span>` : '';
    let contentHTML = '';
    let title = cardData.title || entityLabel;

    const entityTypeToDataAttr = {
        'work': 'data-work-id', 'expression': 'data-expression-id', 'manifestation': 'data-manifestation-id',
        'manifestation_volume': 'data-manifestation-volume-id', 'item': 'data-item-id', 'page': 'data-page-id',
        'visual_object': 'data-vo-id', 'physical_object': 'data-physical-object-id', 'person': 'data-person-id',
        'institution': 'data-institution-id', 'event': 'data-event-id', 'abstract_character': 'data-ac-id',
        'place': 'data-place-id', 'hypothesis': 'data-hypothesis-id'
    };
    const dataAttribute = entityTypeToDataAttr[entityType] ? `${entityTypeToDataAttr[entityType]}="${entityId}"` : `data-id="${entityId}"`;

    // This is a simplified version of the logic in renderRelationshipCard
    // It can be expanded to be as detailed as needed
    contentHTML = `<h3 ${dataAttribute} title="${title}">${title}</h3>`;
    if (entityType === 'person') {
        contentHTML += renderPersonDetails(cardData);
    } else if (cardData.authors) {
        const authorsText = cardData.authors.map(a => `<div>${a.person_name}${renderPersonDetails(a)}</div>`).join('');
        contentHTML += `<p><strong>Authors:</strong></p><div>${authorsText}</div>`;
    } else if (cardData.publishers) {
        const publishersText = cardData.publishers.map(p => `<div>${p.name}</div>`).join('');
        contentHTML += `<p><strong>Publisher:</strong></p><div>${publishersText}</div>`;
    }

    return `
        <div class="result-card">
            <div class="card-header">
                <span class="entity-tag ${entityTypeToCssClass[entityType] || ''}">${entityType.replace(/_/g, ' ')}</span>
                ${projectTag}
            </div>
            ${contentHTML}
            ${renderHypothesisTags(cardData)}
        </div>
    `;
}
// --- MODIFICATION END ---

async function renderEntityDetailsPage(endpoint, titleKey, entityType, voRoleRules = []) {
    const mainContainer = document.querySelector('.container');
    const detailsContainer = document.getElementById('details-page-container');
    const detailsContent = document.getElementById('details-content-wrapper');
    detailsContent.innerHTML = '<p>Loading...</p>';

    mainContainer.style.display = 'none';
    detailsContainer.style.display = 'block';
    window.scrollTo(0, 0);

    try {
        const response = await fetch(endpoint, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();

        const parentOrder = ['work', 'expression', 'manifestation', 'item'];
        const parentRels = data.relationships
            .filter(r => r.group === 'parent')
            .sort((a, b) => {
                const typeA = a.direction === 'outgoing' ? a.target_type : a.source_type;
                const typeB = b.direction === 'outgoing' ? b.target_type : b.source_type;
                return parentOrder.indexOf(typeA) - parentOrder.indexOf(typeB);
            });

        const childRels = data.relationships.filter(r => r.group === 'child');
        const mentionRels = data.relationships.filter(r => r.group === 'mention');
        const otherRels = data.relationships.filter(r => r.group === 'other');

        const mentioningRels = mentionRels.filter(r => r.direction === 'outgoing' && r.type.endsWith('_is_mentioning'));
        const mentionedByRels = mentionRels.filter(r => r.direction === 'outgoing' && r.type.endsWith('_is_mentioned_by'));

        const parentCardsHTML = parentRels.length > 0 ?
            `<div class="parent-entities-container">
                <div class="cards-container">${parentRels.map(renderRelationshipCard).join('')}</div>
            </div>` : '';

        // --- MODIFICATION START: Render roles and personal relationships for persons ---
        let childSectionHTML = '';
        if (entityType === 'person') {
            let relatedEntitiesHTML = '';

            // 1. Process Professional Roles (Author, Editor, etc.)
            if (data.roles_with_entities) {
                const roles = Object.keys(data.roles_with_entities).sort();
                if (roles.length > 0) {
                    relatedEntitiesHTML += roles.map(role => {
                        const entities = data.roles_with_entities[role];
                        const cardsHTML = entities.map(entity => {
                            const cardItem = {
                                direction: 'outgoing',
                                target_id: entity.id,
                                target_type: entity.type,
                                target_label: entity.label,
                                target_card: entity.card
                            };
                            return renderRelationshipCard(cardItem);
                        }).join('');

                        return `<div class="details-section">
                            <h3>${role} of:</h3>
                            <div class="cards-container">${cardsHTML}</div>
                        </div>`;
                    }).join('');
                }
            }

            // 2. Process Personal Relationships (Spouse, Parent, etc.)
            const personalRels = data.relationships.filter(r => r.group === 'personal');
            if (personalRels.length > 0) {
                const groupedPersonalRels = personalRels.reduce((acc, rel) => {
                    const label = rel.type; // This is the display label from the backend
                    if (!acc[label]) acc[label] = [];
                    acc[label].push(rel);
                    return acc;
                }, {});

                const personalRelKeys = Object.keys(groupedPersonalRels).sort();
                relatedEntitiesHTML += personalRelKeys.map(label => {
                    const rels = groupedPersonalRels[label];
                    const cardsHTML = rels.map(renderRelationshipCard).join('');
                    return `<div class="details-section">
                        <h3>${label}:</h3>
                        <div class="cards-container">${cardsHTML}</div>
                    </div>`;
                }).join('');
            }

            // 3. Combine and wrap if there's any content
            if (relatedEntitiesHTML) {
                childSectionHTML = `<div class="details-section"><h2>Related entities:</h2>${relatedEntitiesHTML}</div>`;
            }

        } else if (childRels.length > 0) {
            // Default handling for other entity types
            childSectionHTML = `<div class="details-section">
                <h3>Related entities:</h3>
                <div class="cards-container">${childRels.map(renderRelationshipCard).join('')}</div>
            </div>`;
        }
        // --- MODIFICATION END ---

        // --- NEW: Render hypotheses created by the person ---
        let createdHypothesesHTML = '';
        if (entityType === 'person' && data.created_hypotheses && data.created_hypotheses.length > 0) {
            const personName = data[titleKey] || 'this person';
            const hypothesisGroups = data.created_hypotheses.map(hypo => {
                const aboutCardsHTML = hypo.about_entities.map(entity => {
                    const cardItem = {
                        direction: 'outgoing', // This makes renderRelationshipCard use the target_* properties
                        target_id: entity.id,
                        target_type: entity.type,
                        target_label: entity.label,
                        target_card: entity.card
                    };
                    return renderRelationshipCard(cardItem);
                }).join('');

                return `<div class="hypothesis-group">
                    <h4>
                        <a href="#" class="hypothesis-link" data-hypothesis-id="${hypo.hypothesis_id}">
                            ${hypo.hypothesis_title}
                        </a>
                    </h4>
                    ${aboutCardsHTML ? `<div class="cards-container">${aboutCardsHTML}</div>` : '<p><em>This hypothesis is not linked to any specific entities.</em></p>'}
                </div>`;
            }).join('');

            createdHypothesesHTML = `
                <div class="details-section">
                    <h3>Hypotheses made by ${personName}</h3>
                    ${hypothesisGroups}
                </div>
            `;
        }

        const mentioningCardsHTML = mentioningRels.length > 0 ?
            `<div class="details-section">
                <h3>Mentioning</h3>
                <div class="cards-container">${mentioningRels.map(renderRelationshipCard).join('')}</div>
            </div>` : '';

        const mentionedByCardsHTML = mentionedByRels.length > 0 ?
            `<div class="details-section">
                <h3>Mentioned by</h3>
                <div class="cards-container">${mentionedByRels.map(renderRelationshipCard).join('')}</div>
            </div>` : '';
        
        const otherRelationsHTML = otherRels.length > 0 ?
            `<div class="details-section">
                <h3>Details about ${entityType}</h3>
                ${otherRels.map(rel => {
                    const isOutgoing = rel.direction === 'outgoing';
                    const label = relationshipLabelMap.get(rel.type) || rel.type;
                    const relatedEntityLabel = isOutgoing ? rel.target_label : rel.source_label;
                    const relatedEntityType = isOutgoing ? rel.target_type : rel.source_type;
                    const cardData = isOutgoing ? rel.target_card : rel.source_card;

                    let valueHTML = linkify(relatedEntityLabel);
                    if (relatedEntityType === 'person' && cardData) {
                        valueHTML += renderPersonDetails(cardData);
                    }
                    
                    return `<p><strong>${label}:</strong> ${valueHTML}</p>`;
                }).join('')}
            </div>` : '';
        
        const entityTagHTML = `<div class="details-entity-tag entity-tag ${entityTypeToCssClass[entityType] || ''}">${entityType.replace(/_/g, ' ')}</div>`;

        let pagesSectionHTML = '';
        if (entityType === 'item' && data.pages && data.pages.length > 0) {
            const doesVoMatchRules = (vo, rules) => {
                const andRules = rules.filter(r => r.logic === 'and');
                const orRules = rules.filter(r => r.logic === 'or');
                const notRules = rules.filter(r => r.logic === 'not');

                const roleMap = {
                    'visual_object_owner': (vo.owners || []).map(o => o.toLowerCase()),
                    'visual_object_inscriber': (vo.inscribers || []).map(i => i.toLowerCase()),
                    'visual_object_sender': (vo.senders || []).map(s => s.toLowerCase()),
                    'visual_object_recipient': (vo.recipients || []).map(r => r.toLowerCase())
                };

                const checkMatch = (rule) => {
                    const attributes = roleMap[rule.field] || [];
                    return attributes.includes(rule.value.toLowerCase());
                };

                if (notRules.some(rule => checkMatch(rule))) return false;
                if (andRules.length > 0 && !andRules.every(rule => checkMatch(rule))) return false;
                if (orRules.length > 0 && !orRules.some(rule => checkMatch(rule))) return false;
                
                return true;
            };

            const renderPageList = (pages) => {
                return pages.map(page => {
                    const voCircles = (page.visual_objects || []).map((vo, index) => {
                        return `<span class="vo-circle" title="${vo.vo_name}" data-vo-id="${vo.vo_id}">${index + 1}</span>`;
                    }).join('');
                    return `<li>
                        <span class="page-toggle">${page.page_label}</span>
                        <div class="vo-list" style="display: none;">${voCircles || '<em>No visual objects on this page.</em>'}</div>
                    </li>`;
                }).join('');
            };

            const allPageListItems = renderPageList(data.pages);
            const allPagesSection = `
                <div class="details-section">
                    <h3>All Pages</h3>
                    <ul style="list-style-type: none; padding-left: 0;">${allPageListItems}</ul>
                </div>`;

            if (voRoleRules && voRoleRules.length > 0) {
                const filteredPages = data.pages
                    .map(page => ({
                        ...page,
                        visual_objects: (page.visual_objects || []).filter(vo => doesVoMatchRules(vo, voRoleRules))
                    }))
                    .filter(page => page.visual_objects.length > 0);

                if (filteredPages.length > 0) {
                    const filteredPageListItems = renderPageList(filteredPages);
                    pagesSectionHTML = `
                        <div class="details-section">
                            <h3>Pages Satisfying Filter</h3>
                            <ul style="list-style-type: none; padding-left: 0;">${filteredPageListItems}</ul>
                        </div>
                        ${allPagesSection}`;
                } else {
                    pagesSectionHTML = `
                        <div class="details-section">
                            <h3>Pages Satisfying Filter</h3>
                            <p><em>No pages contain visual objects matching the current filter.</em></p>
                        </div>
                        ${allPagesSection}`;
                }
            } else {
                pagesSectionHTML = allPagesSection;
            }
        }

        let hypothesisHTML = '';
        if (data.hypotheses && data.hypotheses.length > 0) {
            const hypothesisItems = data.hypotheses.map(hypo => {
                return `<div class="details-hypothesis-item">
                    <span class="hypothesis-arrow">&rarr;</span>
                    <div class="hypothesis-tag" data-hypothesis-id="${hypo.hypothesis_id}" title="${hypo.hypothesis_title}">
                        Hypothesis from ${hypo.creator_name}
                    </div>
                </div>`;
            }).join('');
            hypothesisHTML = `<div class="details-hypothesis-container">${hypothesisItems}</div>`;
        }

        const pageContent = `
            <div class="details-header">
                ${entityTagHTML}
                <h1>${data[titleKey]}</h1>
            </div>
            ${hypothesisHTML}
            ${parentCardsHTML}
            ${otherRelationsHTML}
            ${pagesSectionHTML}
            ${childSectionHTML}
            ${createdHypothesesHTML}
            ${mentioningCardsHTML}
            ${mentionedByCardsHTML}
        `;

        detailsContent.innerHTML = pageContent;

    } catch (error) {
        detailsContent.innerHTML = `<p style="color: red;">Could not load details: ${error.message}</p>`;
    }
}

function handleAuthorClick(authorId) {
    const endpoint = `${API_BASE_URL}/details/person/${encodeURIComponent(authorId)}`;
    renderEntityDetailsPage(endpoint, 'person_name', 'person');
}

function handleAcClick(acId) {
    const endpoint = `${API_BASE_URL}/details/abstract_character/${encodeURIComponent(acId)}`;
    renderEntityDetailsPage(endpoint, 'ac_name', 'abstract_character');
}

function handleExpressionClick(expressionId) {
    const endpoint = `${API_BASE_URL}/details/expression/${encodeURIComponent(expressionId)}`;
    renderEntityDetailsPage(endpoint, 'expression_title', 'expression');
}

function handleWorkClick(workId) {
    const endpoint = `${API_BASE_URL}/details/work/${encodeURIComponent(workId)}`;
    renderEntityDetailsPage(endpoint, 'work_title', 'work');
}

function handleVisualObjectClick(voId) {
    const endpoint = `${API_BASE_URL}/details/visual_object/${encodeURIComponent(voId)}`;
    renderEntityDetailsPage(endpoint, 'vo_name', 'visual_object');
}

function handleManifestationClick(manifestationId) {
    const endpoint = `${API_BASE_URL}/details/manifestation/${encodeURIComponent(manifestationId)}`;
    renderEntityDetailsPage(endpoint, 'manifestation_title', 'manifestation');
}

// NEW
function handleManifestationVolumeClick(volumeId) {
    const endpoint = `${API_BASE_URL}/details/manifestation_volume/${encodeURIComponent(volumeId)}`;
    renderEntityDetailsPage(endpoint, 'manifestation_volume_title', 'manifestation_volume');
}

function handlePlaceClick(placeId) {
    const endpoint = `${API_BASE_URL}/details/place/${encodeURIComponent(placeId)}`;
    renderEntityDetailsPage(endpoint, 'place_name', 'place');
}

function handleItemClick(itemId) {
    const endpoint = `${API_BASE_URL}/details/item/${encodeURIComponent(itemId)}`;
    const voRoleRules = (currentQueryForRendering.rules || []).filter(r => [
        'visual_object_owner', 
        'visual_object_inscriber', 
        'visual_object_sender', 
        'visual_object_recipient'
    ].includes(r.field));
    renderEntityDetailsPage(endpoint, 'item_label', 'item', voRoleRules);
}

function handleInstitutionClick(institutionId) {
    const endpoint = `${API_BASE_URL}/details/institution/${encodeURIComponent(institutionId)}`;
    renderEntityDetailsPage(endpoint, 'institution_name', 'institution');
}

function handlePageClick(pageId) {
    const endpoint = `${API_BASE_URL}/details/page/${encodeURIComponent(pageId)}`;
    renderEntityDetailsPage(endpoint, 'page_label', 'page');
}

function handlePhysicalObjectClick(physicalObjectId) {
    const endpoint = `${API_BASE_URL}/details/physical_object/${encodeURIComponent(physicalObjectId)}`;
    renderEntityDetailsPage(endpoint, 'po_name', 'physical_object');
}

function handleHypothesisClick(hypothesisId) {
    const endpoint = `${API_BASE_URL}/details/hypothesis/${encodeURIComponent(hypothesisId)}`;
    renderEntityDetailsPage(endpoint, 'hypothesis_title', 'hypothesis');
}

async function initialize() {
    const container = document.getElementById('filter-rows-container');
    try {
        const response = await fetch(`${API_BASE_URL}/filters/options`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        availableOptions = await response.json();

        const projectOptions = availableOptions.projects || [];
        const projectSelect = createCustomMultiSelect(projectOptions, 'project', { hideEmpty: true });
        projectSelect.id = 'project-select';

        const initialRow = document.createElement('div');
        initialRow.className = 'filter-row';
        initialRow.innerHTML = `
            <span style="font-weight: bold; min-width: 80px;">Projects:</span>
            <span class="value-placeholder"></span>
            <select id="entity-select">
                <option value="work" selected>Work</option>
                <option value="expression">Expression</option>
                <option value="manifestation">Manifestation</option>
                <option value="item">Item</option>
                <option value="person">Person</option>
            </select>
            <div class="row-controls">
                <button class="add-row-btn" title="Add new row">+</button>
            </div>
        `;
        initialRow.querySelector('.value-placeholder').appendChild(projectSelect);
        container.appendChild(initialRow);
        
        initialRow.querySelector('.add-row-btn').addEventListener('click', () => {
            addFilterRow(container);
        });
        
        document.getElementById('entity-select').addEventListener('change', handleEntityChange);

        document.getElementById('back-to-search-btn').addEventListener('click', showSearchPage);

        document.body.addEventListener('click', (e) => {
            const personTarget = e.target.closest('.author-link, [data-person-id]:not(a)');
            const workTarget = e.target.closest('.work-link, [data-work-id]:not(a)');
            const acLink = e.target.closest('.ac-link, [data-ac-id]');
            const expressionTarget = e.target.closest('.expression-link, [data-expression-id]:not(a)');
            const voTarget = e.target.closest('.vo-link, .vo-circle, [data-vo-id]:not(a)');
            const manifestationTarget = e.target.closest('.manifestation-link, [data-manifestation-id]:not(a)');
            const manifestationVolumeTarget = e.target.closest('.manifestation-volume-link, [data-manifestation-volume-id]:not(a)'); // NEW
            const placeLink = e.target.closest('.place-link');
            const itemTarget = e.target.closest('.item-link, [data-item-id]:not(a)');
            const institutionTarget = e.target.closest('.institution-link, [data-institution-id]:not(a)');
            const pageTarget = e.target.closest('.page-link, [data-page-id]:not(a)');
            const physicalObjectTarget = e.target.closest('.physical-object-link, [data-physical-object-id]:not(a)');
            const hypothesisTarget = e.target.closest('.hypothesis-link, .hypothesis-tag');
            const pagesMainToggle = e.target.closest('.pages-main-toggle');
            const showMoreBtn = e.target.closest('.show-more-pages-btn');
            
            if (showMoreBtn) {
                e.preventDefault();
                const itemId = showMoreBtn.dataset.itemId;
                const pages = itemPagesData[itemId];
                if (!pages) return;

                let displayedCount = parseInt(showMoreBtn.dataset.displayed, 10);
                const nextPages = pages.slice(displayedCount, displayedCount + 10);

                const query = currentQueryForRendering;
                const voRoleRules = query.rules.filter(r => [
                    'visual_object_owner', 'visual_object_inscriber', 
                    'visual_object_sender', 'visual_object_recipient'
                ].includes(r.field));
                
                const newContent = renderPageListItems(nextPages, voRoleRules);
                
                const list = showMoreBtn.previousElementSibling;
                if (list) {
                    list.insertAdjacentHTML('beforeend', newContent);
                }

                displayedCount += nextPages.length;
                showMoreBtn.dataset.displayed = displayedCount;

                if (displayedCount >= pages.length) {
                    showMoreBtn.style.display = 'none';
                }
            } else if (e.target.classList.contains('page-toggle')) {
                const voList = e.target.nextElementSibling;
                if (voList && voList.classList.contains('vo-list')) {
                    voList.style.display = voList.style.display === 'none' ? 'block' : 'none';
                }
            } else if (pagesMainToggle) {
                const container = pagesMainToggle.nextElementSibling;
                if (container && container.classList.contains('pages-list-container')) {
                    container.style.display = container.style.display === 'none' ? 'block' : 'none';
                }
            } else if (personTarget) {
                e.preventDefault();
                const personId = personTarget.dataset.authorId || personTarget.dataset.personId;
                handleAuthorClick(personId);
            } else if (acLink) {
                e.preventDefault();
                handleAcClick(acLink.dataset.acId);
            } else if (expressionTarget && expressionTarget.dataset.expressionId) {
                e.preventDefault();
                handleExpressionClick(expressionTarget.dataset.expressionId);
            } else if (workTarget && workTarget.dataset.workId) {
                e.preventDefault();
                handleWorkClick(workTarget.dataset.workId);
            } else if (voTarget && voTarget.dataset.voId) {
                e.preventDefault();
                handleVisualObjectClick(voTarget.dataset.voId);
            } else if (manifestationTarget && manifestationTarget.dataset.manifestationId) {
                e.preventDefault();
                handleManifestationClick(manifestationTarget.dataset.manifestationId);
            } else if (manifestationVolumeTarget && manifestationVolumeTarget.dataset.manifestationVolumeId) { // NEW
                e.preventDefault();
                handleManifestationVolumeClick(manifestationVolumeTarget.dataset.manifestationVolumeId);
            } else if (placeLink) {
                e.preventDefault();
                handlePlaceClick(placeLink.dataset.placeId);
            } else if (itemTarget && itemTarget.dataset.itemId) {
                e.preventDefault();
                handleItemClick(itemTarget.dataset.itemId);
            } else if (institutionTarget && institutionTarget.dataset.institutionId) {
                e.preventDefault();
                handleInstitutionClick(institutionTarget.dataset.institutionId);
            } else if (pageTarget && pageTarget.dataset.pageId) {
                e.preventDefault();
                handlePageClick(pageTarget.dataset.pageId);
            } else if (physicalObjectTarget && physicalObjectTarget.dataset.physicalObjectId) {
                e.preventDefault();
                handlePhysicalObjectClick(physicalObjectTarget.dataset.physicalObjectId);
            } else if (hypothesisTarget && hypothesisTarget.dataset.hypothesisId) {
                e.preventDefault();
                handleHypothesisClick(hypothesisTarget.dataset.hypothesisId);
            }
        });

    } catch (error) {
        container.innerHTML = `
            <h1>Connection Error</h1>
            <p style="color: red;">Could not connect to the API at <strong>${API_BASE_URL}</strong>.</p>
            <p>Please make sure the FastAPI server is running and that CORS is configured correctly.</p>
        `;
    }
}


document.addEventListener('DOMContentLoaded', initialize);

