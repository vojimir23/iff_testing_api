const API_BASE_URL = "http://swarmstg-master2.srv.ict.unimi.it:9001";
//const API_BASE_URL = "http://127.0.0.1:8000";

let availableOptions = {}; // Will store the full nested object from the API
let currentFilterOptions = {}; // Will store the active options for the UI
let itemPagesData = {};
let currentQueryForRendering = {};
let currentDetailsData = {}; // To store data for "Load More" functionality

// --- Global variables for graph state ---
let currentGraphData = {};
let nodeElements = new Map();
let edgeElements = [];
let positions = {};

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
    'manifestation_volume': 'entity-tag-manifestation-volume',
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

function renderPersonDetails(person) {
    if (!person) return '';
    if (!person.name && !person.person_name) return '';
    if (!person.death_date) {
        return '';
    }
    const parts = [
        person.birth_date,
        person.birth_date_notes,
        person.death_date,
        person.death_date_notes
    ].filter(Boolean);
    if (parts.length === 0) return '';
    return `<span style="font-size: 0.8em; color: #6c757d; display: block; margin-top: -2px;">(${parts.join(' - ')})</span>`;
}

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
    const entity = document.getElementById('entity-select').value;
    if (entity === 'graphs') {
        fetchAndRenderGraph();
        return;
    }

    const query = {
        projects: [],
        entity: entity,
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
        
        if (!field || !logic) return;

        const multiselect = row.querySelector('.custom-multiselect');
        const dateFilter = row.querySelector('.date-filter-container');
        const textSearchFilter = row.querySelector('.text-search-container');
        const proximitySearchFilter = row.querySelector('.proximity-search-container');

        if (multiselect) {
            const checkedInputs = multiselect.querySelectorAll('input[type="checkbox"]:checked');
            const values = Array.from(checkedInputs)
                .map(input => input.value)
                .filter(val => val !== '__SELECT_ALL__');

            if (values.length > 0) {
                query.rules.push({ field, logic, values, op: 'equals' });
            }
        } 
        else if (field === 'publication_date' && dateFilter) {
            const fromVal = dateFilter.querySelector('.date-from').value;
            const toVal = dateFilter.querySelector('.date-to').value;
            if (fromVal) {
                query.rules.push({ field: 'publication_date', logic: 'gte', values: [fromVal] });
            }
            if (toVal) {
                query.rules.push({ field: 'publication_date', logic: 'lte', values: [toVal] });
            }
        }
        else if (field === 'physical_object_date' && dateFilter) {
            const fromVal = dateFilter.querySelector('.date-from').value;
            const toVal = dateFilter.querySelector('.date-to').value;
            if (fromVal) {
                query.rules.push({ field: 'physical_object_date', logic: 'gte', values: [fromVal] });
            }
            if (toVal) {
                query.rules.push({ field: 'physical_object_date', logic: 'lte', values: [toVal] });
            }
        }
        else if (field === 'person_dates' && dateFilter) {
            const fromVal = dateFilter.querySelector('.date-from').value;
            const toVal = dateFilter.querySelector('.date-to').value;
            if (fromVal) {
                const fromEra = dateFilter.querySelector('.era-from').value;
                query.rules.push({ field: 'person_birth_date', logic: 'gte', values: [fromVal], era: fromEra });
            }
            if (toVal) {
                const toEra = dateFilter.querySelector('.era-to').value;
                query.rules.push({ field: 'person_death_date', logic: 'lte', values: [toVal], era: toEra });
            }
        }
        else if (field === 'visual_object_transcription' && textSearchFilter) {
            const searchInput = textSearchFilter.querySelector('.text-search-input');
            const operatorSelect = textSearchFilter.querySelector('.text-search-operator');
            const caseSensitiveCheckbox = textSearchFilter.querySelector('.case-sensitive-checkbox');
            const diacriticsSensitiveCheckbox = textSearchFilter.querySelector('.diacritics-sensitive-checkbox');
            
            const searchValue = searchInput.value.trim();
            const searchOperator = operatorSelect.value;

            if (searchValue) {
                query.rules.push({
                    field: 'visual_object_transcription',
                    logic: logic,
                    values: [searchValue],
                    op: searchOperator,
                    case_sensitive: caseSensitiveCheckbox.checked,
                    diacritics_sensitive: diacriticsSensitiveCheckbox.checked
                });
            }
        }
        else if (field === 'proximity_text_search' && proximitySearchFilter) {
            const termRows = proximitySearchFilter.querySelectorAll('.proximity-term-row');
            const terms = [];
            
            termRows.forEach((termRow, index) => {
                if (termRow.style.display === 'none') return;

                const textInput = termRow.querySelector('.proximity-text-input');
                if (textInput && textInput.value.trim()) {
                    const term = { text: textInput.value.trim() };
                    if (index > 0) {
                        term.logic = termRow.querySelector('.proximity-logic-select').value;
                        term.proximity = termRow.querySelector('.proximity-op-select').value;
                    }
                    terms.push(term);
                }
            });

            if (terms.length > 0) {
                const distance = proximitySearchFilter.querySelector('.proximity-distance-input').value;
                const caseSensitive = proximitySearchFilter.querySelector('.case-sensitive-checkbox').checked;
                const diacriticsSensitive = proximitySearchFilter.querySelector('.diacritics-sensitive-checkbox').checked;
                const exactMatch = proximitySearchFilter.querySelector('.exact-match-checkbox').checked;

                query.rules.push({
                    field: 'proximity_text_search',
                    logic: logic,
                    proximity_query: {
                        terms: terms,
                        distance: parseInt(distance, 10) || 5,
                        case_sensitive: caseSensitive,
                        diacritics_sensitive: diacriticsSensitive,
                        exact_match: exactMatch
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
                    return rule.values.some(value => attributes.includes(value));
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

function highlightText(text, terms, flags) {
    if (!terms || terms.length === 0 || !text) {
        return text;
    }

    // Sanitize terms to prevent regex injection
    const sanitizedTerms = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (sanitizedTerms.length === 0) return text;

    // Create a regex to find any of the terms
    const regexFlags = flags.case_sensitive ? 'g' : 'gi';
    const pattern = sanitizedTerms.map(term => flags.exact_match ? `\\b${term}\\b` : term).join('|');
    
    try {
        const regex = new RegExp(pattern, regexFlags);
        return text.replace(regex, (match) => `<span class="highlight">${match}</span>`);
    } catch (e) {
        console.error("Error creating regex for highlighting:", e);
        return text; // Return original text if regex is invalid
    }
}

function displayResults(results, entity) {
    const resultsContent = document.getElementById('results-content');
    itemPagesData = {}; 

    if (results.length === 0) {
        resultsContent.innerHTML = '<p>No results match the current filters.</p>';
        return;
    }

    const renderProjectTags = (projects) => {
        if (!projects || projects.length === 0) return '';
        const tags = projects.map(p => `<span class="project-tag">${p}</span>`).join('');
        return `<div class="project-tags-container">${tags}</div>`;
    };

    if (entity === 'work') {
        resultsContent.innerHTML = results.map(work => {
            const card = work.card;
            const authorsText = (card.authors && card.authors.length > 0)
                ? card.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-work">Work</span>
                    ${renderProjectTags(work.projects)}
                </div>
                <h3 data-work-id="${work.work_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Author of work:</strong></p><div>${authorsText}</div>
                <p><strong>Classifications:</strong> ${card.classifications}</p>
                ${renderHypothesisTags(work)}
            </div>`;
        }).join('');
    } else if (entity === 'expression') {
        resultsContent.innerHTML = results.map(exp => {
            const card = exp.card;
            const primaryAuthorsText = (card.primary_authors && card.primary_authors.length > 0)
                ? card.primary_authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            
            let secondaryAuthorsHTML = '';
            if (card.secondary_authors && card.secondary_authors.length > 0) {
                const secondaryAuthorsText = card.secondary_authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('');
                secondaryAuthorsHTML = `<p><strong>Secondary Authors:</strong></p><div>${secondaryAuthorsText}</div>`;
            }
            
            const responsibilityHTML = card.responsibility ? `<p><strong>Responsibility:</strong> ${card.responsibility}</p>` : '';
            
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-expression">Expression</span>
                    ${renderProjectTags(exp.projects)}
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
            const authorsText = (card.authors && card.authors.length > 0)
                ? card.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            const placeText = card.place ? card.place.place_name : '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-manifestation">Manifestation</span>
                    ${renderProjectTags(man.projects)}
                </div>
                <h3 data-manifestation-id="${man.manifestation_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Publisher:</strong></p><div>${publishersText}</div>
                <p><strong>Author:</strong></p><div>${authorsText}</div>
                <p><strong>Place:</strong> ${placeText}</p>
                ${renderHypothesisTags(man)}
            </div>`;
        }).join('');
    } else if (entity === 'item') {
        resultsContent.innerHTML = results.map(item => {
            const card = item.card;
            const authorsText = (card.authors && card.authors.length > 0)
                ? card.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            const physicalObjectHTML = card.physical_object_info ? 
                `<div class="physical-object-tag-container"><span class="physical-object-tag">${card.physical_object_info}</span></div>` : '';
            const annotatedPagesHTML = card.annotated_pages_info ?
                `<div class="annotated-pages-tag-container"><span class="annotated-pages-tag">${card.annotated_pages_info}</span></div>` : '';

            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-item">Item</span>
                    ${renderProjectTags(item.projects)}
                </div>
                <h3 data-item-id="${item.item_id}" title="${card.title}">${card.title}</h3>
                <p><strong>Authors:</strong></p><div>${authorsText}</div>
                <p><strong>Date:</strong> ${card.date}</p>
                ${physicalObjectHTML}
                ${annotatedPagesHTML}
                ${renderHypothesisTags(item)}
            </div>`;
        }).join('');
    } else if (entity === 'page') {
        resultsContent.innerHTML = results.map(page => {
            const card = page.card || {};
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-page">Page</span>
                    ${renderProjectTags(page.projects)}
                </div>
                <h3 data-page-id="${page.page_id || ''}" title="${card.title || card.page_label || ''}">${card.title || card.page_label || 'Page'}</h3>
                ${card.Item ? `<p><strong>Item:</strong> ${card.Item}</p>` : ''}
                ${card.Manifestation ? `<p><strong>Manifestation:</strong> ${card.Manifestation}</p>` : ''}
                ${card.Publisher ? `<p><strong>Publisher:</strong> ${card.Publisher}</p>` : ''}
                ${card['Unità materiale'] ? `<p><strong>Unità materiale:</strong> ${card['Unità materiale']}</p>` : ''}
                ${renderHypothesisTags(page)}
            </div>`;
        }).join('');
    } else if (entity === 'person') {
        resultsContent.innerHTML = results.map(person => {
            const card = person.card;
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-person">Person</span>
                    ${renderProjectTags(person.projects)}
                </div>
                <h3 data-person-id="${person.person_id}" title="${card.name}">${card.name}</h3>
                ${renderPersonDetails(card)}
                ${renderHypothesisTags(person)}
            </div>`;
        }).join('');
    } else if (entity === 'visual_object') {
        resultsContent.innerHTML = results.map(vo => {
            const card = vo.card;
            let transcriptionSnippet = card.transcription_snippet;
            if (transcriptionSnippet) {
                const searchRules = (currentQueryForRendering.rules || []).filter(r => 
                    r.field === 'visual_object_transcription' || r.field === 'proximity_text_search'
                );

                if (searchRules.length > 0) {
                    const termsToHighlight = [];
                    const firstRule = searchRules[0];
                    const flags = {
                        case_sensitive: firstRule.case_sensitive || (firstRule.proximity_query && firstRule.proximity_query.case_sensitive),
                        exact_match: firstRule.proximity_query && firstRule.proximity_query.exact_match
                    };

                    searchRules.forEach(rule => {
                        if (rule.field === 'visual_object_transcription' && rule.values) {
                            if (rule.op === 'all_words' || rule.op === 'any_word') {
                                termsToHighlight.push(...rule.values[0].split(/\s+/));
                            } else {
                                termsToHighlight.push(rule.values[0]);
                            }
                        } else if (rule.field === 'proximity_text_search' && rule.proximity_query) {
                            rule.proximity_query.terms.forEach(term => termsToHighlight.push(term.text));
                        }
                    });
                    
                    const uniqueTerms = [...new Set(termsToHighlight.filter(t => t))];

                    if (uniqueTerms.length > 0) {
                        transcriptionSnippet = highlightText(transcriptionSnippet, uniqueTerms, flags);
                    }
                }
            }
            const transcriptionSnippetHTML = transcriptionSnippet ?
                `<p><strong>Transcription:</strong> <em>${transcriptionSnippet}</em></p>` : '';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-visual_object">Visual Object</span>
                    ${renderProjectTags(vo.projects)}
                </div>
                <h3 data-vo-id="${vo.visual_object_id}" title="${card.title}">${card.title}</h3>
                ${transcriptionSnippetHTML}
                ${renderHypothesisTags(vo)}
            </div>`;
        }).join('');
        } else if (entity === 'physical_object') {
            resultsContent.innerHTML = results.map(po => {
                const card = po.card;
                let detailsHTML = '';

                if (po.human_readable_id) {
                    if (po.human_readable_id.startsWith("PO_PAG_PO_")) {
                        if (card['Page name:']) {
                            detailsHTML += `<p><strong>Page name:</strong> ${card['Page name:']}</p>`;
                        }
                        if (card['Contenuto in:']) {
                            detailsHTML += `<p><strong>Contenuto in:</strong> ${card['Contenuto in:']}</p>`;
                        }
                        if (card['Item:']) {
                            detailsHTML += `<p><strong>Item:</strong> ${card['Item:']}</p>`;
                        }
                    } else if (po.human_readable_id.startsWith("PO_PAG_")) {
                        if (card['Page name:']) {
                            detailsHTML += `<p><strong>Page name:</strong> ${card['Page name:']}</p>`;
                        }
                         if (card['Item:']) {
                            detailsHTML += `<p><strong>Item:</strong> ${card['Item:']}</p>`;
                        }
                    } else if (po.human_readable_id.startsWith("PO_IND_")) {
                        if (card['Descrizione:']) {
                            detailsHTML += `<p><strong>Descrizione:</strong> ${card['Descrizione:']}</p>`;
                        }
                    } else if (po.human_readable_id.startsWith("PO_")) {
                         if (card['Item:']) {
                            detailsHTML += `<p><strong>Item:</strong> ${card['Item:']}</p>`;
                        }
                    }
                }

                return `
                <div class="result-card">
                    <div class="card-header">
                        <span class="entity-tag entity-tag-physical_object">Physical Object</span>
                        ${renderProjectTags(po.projects)}
                    </div>
                    <h3 data-physical-object-id="${po.physical_object_id}" title="${card.title}">${card.title}</h3>
                    ${detailsHTML}
                    ${renderHypothesisTags(po)}
                </div>`;
            }).join('');
    } else if (entity === 'institution') {
        resultsContent.innerHTML = results.map(inst => {
            const card = inst.card;
            const placeText = card.place ? card.place.place_name : '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-institution">Institution</span>
                    ${renderProjectTags(inst.projects)}
                </div>
                <h3 data-institution-id="${inst.institution_id}" title="${card.name}">${card.name}</h3>
                <p><strong>Place:</strong> ${placeText}</p>
                ${renderHypothesisTags(inst)}
            </div>`;
        }).join('');
    } else if (entity === 'event') {
        resultsContent.innerHTML = results.map(evt => {
            const card = evt.card;
            const placeText = card.place ? card.place.place_name : '<em>None</em>';
            const dateText = card.date || '<em>None</em>';
            return `
            <div class="result-card">
                <div class="card-header">
                    <span class="entity-tag entity-tag-event">Event</span>
                    ${renderProjectTags(evt.projects)}
                </div>
                <h3 data-event-id="${evt.event_id}" title="${card.event_name}">${card.event_name}</h3>
                <p><strong>Date:</strong> ${dateText}</p>
                <p><strong>Place:</strong> ${placeText}</p>
                ${renderHypothesisTags(evt)}
            </div>`;
        }).join('');
    }
}

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
        const isObject = typeof opt === 'object' && opt !== null;
        const optionValue = isObject ? opt.value : opt;
        const optionLabel = isObject ? opt.label : opt;
        const optionId = `${selectId}-opt-${String(optionValue).replace(/[^a-zA-Z0-9]/g, '')}`;
        optionsHTML += `
            <li class="multiselect-option">
                <input type="checkbox" id="${optionId}" value="${optionValue}">
                <label for="${optionId}">${optionLabel}</label>
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

    const handleChange = () => {
        updateDisplay();
        if (fieldName === 'project') {
            updateFilterOptionsForProjects();
        }
        buildQueryAndFetch();
    };

    selectAllCheckbox.addEventListener('change', () => {
        const visibleCheckboxes = itemCheckboxes.filter(cb => cb.closest('li').style.display !== 'none');
        visibleCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
        handleChange();
    });

    itemCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            if (!checkbox.checked) {
                selectAllCheckbox.checked = false;
            }
            handleChange();
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

function createTextSearchFilter() {
    const container = document.createElement('div');
    container.className = 'text-search-container';
    container.style.display = 'flex';
    container.style.gap = '10px';
    container.style.alignItems = 'center';

    const uniqueId = `text-search-${Date.now()}`;

    container.innerHTML = `
        <input type="text" class="text-search-input" placeholder="Enter search text..." style="flex-grow: 1;">
        <div class="custom-select-wrapper">
            <select class="text-search-operator">
                <option value="all_words" selected>All words</option>
                <option value="phrase">Phrase</option>
                <option value="any_word">At least one word</option>
            </select>
        </div>
        <div class="text-search-options">
            <label for="case-sensitive-${uniqueId}">
                <input type="checkbox" id="case-sensitive-${uniqueId}" class="case-sensitive-checkbox">
                Case sensitive
            </label>
            <label for="diacritics-sensitive-${uniqueId}">
                <input type="checkbox" id="diacritics-sensitive-${uniqueId}" class="diacritics-sensitive-checkbox">
                Diacritics sensitive
            </label>
        </div>
    `;

    const debouncedFetch = debounce(buildQueryAndFetch, 300);

    container.querySelector('.text-search-input').addEventListener('keyup', debouncedFetch);
    container.querySelector('.text-search-operator').addEventListener('change', buildQueryAndFetch);
    container.querySelector('.case-sensitive-checkbox').addEventListener('change', buildQueryAndFetch);
    container.querySelector('.diacritics-sensitive-checkbox').addEventListener('change', buildQueryAndFetch);

    return container;
}

function createProximitySearchFilter() {
    const container = document.createElement('div');
    container.className = 'proximity-search-container';
    const uniqueId = `prox-search-${Date.now()}`;

    container.innerHTML = `
        <div class="proximity-term-row">
            <input type="text" class="proximity-text-input" placeholder="Enter first word...">
        </div>
        <div class="proximity-term-row" style="display: none;">
            <div class="proximity-controls">
                <select class="proximity-logic-select">
                    <option value="and" selected>AND</option>
                    <option value="or">OR</option>
                    <option value="not">NOT</option>
                </select>
                <input type="text" class="proximity-text-input" placeholder="Enter second word...">
                <select class="proximity-op-select">
                    <option value="near" selected>near</option>
                    <option value="before">before</option>
                    <option value="after">after</option>
                </select>
                <button type="button" class="remove-term-btn" title="Remove term">-</button>
            </div>
        </div>
        <div class="proximity-term-row" style="display: none;">
            <div class="proximity-controls">
                <select class="proximity-logic-select">
                    <option value="and" selected>AND</option>
                    <option value="or">OR</option>
                    <option value="not">NOT</option>
                </select>
                <input type="text" class="proximity-text-input" placeholder="Enter third word...">
                <select class="proximity-op-select">
                    <option value="near" selected>near</option>
                    <option value="before">before</option>
                    <option value="after">after</option>
                </select>
                <button type="button" class="remove-term-btn" title="Remove term">-</button>
            </div>
        </div>
        <div class="proximity-footer">
            <button type="button" class="add-term-btn" title="Add term">+</button>
            <div class="proximity-distance">
                within <input type="number" class="proximity-distance-input" value="5" min="1"> words
            </div>
            <div class="text-search-options">
                <label for="case-sensitive-${uniqueId}">
                    <input type="checkbox" id="case-sensitive-${uniqueId}" class="case-sensitive-checkbox">
                    Case sensitive
                </label>
                <label for="diacritics-sensitive-${uniqueId}">
                    <input type="checkbox" id="diacritics-sensitive-${uniqueId}" class="diacritics-sensitive-checkbox">
                    Diacritics sensitive
                </label>
                <label for="exact-match-${uniqueId}">
                    <input type="checkbox" id="exact-match-${uniqueId}" class="exact-match-checkbox">
                    Exact match
                </label>
            </div>
        </div>
    `;

    const debouncedFetch = debounce(buildQueryAndFetch, 300);
    const termRows = Array.from(container.querySelectorAll('.proximity-term-row'));
    const addBtn = container.querySelector('.add-term-btn');

    const updateAddButtonState = () => {
        const visibleRows = termRows.filter(r => r.style.display !== 'none').length;
        addBtn.disabled = visibleRows >= 3;
    };

    addBtn.addEventListener('click', () => {
        const firstHiddenRow = termRows.find(r => r.style.display === 'none');
        if (firstHiddenRow) {
            firstHiddenRow.style.display = 'block';
        }
        updateAddButtonState();
    });

    termRows.forEach((row, index) => {
        if (index > 0) { // Only rows 2 and 3 have remove buttons
            const removeBtn = row.querySelector('.remove-term-btn');
            removeBtn.addEventListener('click', () => {
                row.querySelector('.proximity-text-input').value = '';
                row.style.display = 'none';
                updateAddButtonState();
                buildQueryAndFetch();
            });
        }
    });

    container.querySelectorAll('input[type="text"]').forEach(el => el.addEventListener('keyup', debouncedFetch));
    container.querySelectorAll('select, input[type="checkbox"], input[type="number"]').forEach(el => {
        el.addEventListener('change', buildQueryAndFetch);
    });
    
    updateAddButtonState(); // Initial state
    return container;
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function renderValueSelector(field, valuePlaceholder) {
    valuePlaceholder.innerHTML = '';

    if (!field) return;

    if (field === 'publication_date') {
        valuePlaceholder.innerHTML = `
            <div class="date-filter-container">
                <label>From:</label>
                <input type="text" class="date-from" placeholder="Year/Century">
                <label>To:</label>
                <input type="text" class="date-to" placeholder="Year/Century">
            </div>
        `;
        valuePlaceholder.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', buildQueryAndFetch);
        });
    } else if (field === 'physical_object_date') {
        valuePlaceholder.innerHTML = `
            <div class="date-filter-container">
                <label>From:</label>
                <input type="text" class="date-from" placeholder="Year/Century">
                <label>To:</label>
                <input type="text" class="date-to" placeholder="Year/Century">
            </div>
        `;
        valuePlaceholder.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', buildQueryAndFetch);
        });
    } else if (field === 'person_dates') {
        valuePlaceholder.innerHTML = `
            <div class="date-filter-container">
                <label>From:</label>
                <div class="date-input-group">
                    <input type="text" class="date-from" placeholder="Year/Century/Roman">
                    <select class="era-select era-from">
                        <option value="AD" selected>AD</option>
                        <option value="BC">BC</option>
                    </select>
                </div>
                <label>To:</label>
                <div class="date-input-group">
                    <input type="text" class="date-to" placeholder="Year/Century/Roman">
                    <select class="era-select era-to">
                        <option value="AD" selected>AD</option>
                        <option value="BC">BC</option>
                    </select>
                </div>
            </div>
        `;
        valuePlaceholder.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', buildQueryAndFetch);
        });
    } else if (field === 'person_gender') {
        const genderOptions = [
            { label: 'Male', value: 'M' },
            { label: 'Female', value: 'F' }
        ];
        const customSelect = createCustomMultiSelect(genderOptions, 'person_gender', {
            placeholder: '-- Select Gender --',
            hideEmpty: true
        });
        valuePlaceholder.appendChild(customSelect);
    } else if (field === 'visual_object_transcription') {
        const textSearchUI = createTextSearchFilter();
        valuePlaceholder.appendChild(textSearchUI);
    } else if (field === 'proximity_text_search') {
        const proximitySearchUI = createProximitySearchFilter();
        valuePlaceholder.appendChild(proximitySearchUI);
    } else {
        const optionsMap = {
            'author': currentFilterOptions.authors,
            'classification': currentFilterOptions.classifications,
            'type_of_expression': currentFilterOptions.types_of_expression,
            'language': currentFilterOptions.languages,
            'place': currentFilterOptions.places,
            'physical_object_place': currentFilterOptions.physical_object_places,
            'preservation_status': currentFilterOptions.preservation_statuses,
            'owner': currentFilterOptions.owners,
            'material': currentFilterOptions.materials,
            'type_of_item': currentFilterOptions.types_of_item,
            'work_title': currentFilterOptions.work_titles,
            'person_name': currentFilterOptions.all_people,
            'person_role': currentFilterOptions.person_roles,
            'institution_name': currentFilterOptions.institution_names,
            'institution_place': currentFilterOptions.institution_places,
            'event_name': currentFilterOptions.event_names,
            'search_for_roles_in_expression': currentFilterOptions.search_for_roles_in_expression,
            'search_for_roles_in_manifestation': currentFilterOptions.search_for_roles_in_manifestation,
            'roles_related_to_visual_object': currentFilterOptions.visual_object_roles,
            'roles_related_to_physical_object': currentFilterOptions.physical_object_roles,
            'person_or_institution': currentFilterOptions.all_people_and_institutions,
            'type_of_visual_object': currentFilterOptions.types_of_visual_object,
            'type_of_physical_object': currentFilterOptions.types_of_physical_object,
            'visual_object_function': currentFilterOptions.visual_object_functions,
            'visual_object_language': currentFilterOptions.visual_object_languages,
            'visual_object_instrument': currentFilterOptions.visual_object_instruments,
            'visual_object_colour': currentFilterOptions.visual_object_colours
        };
        const configMap = {
            'author': { hideEmpty: true, placeholder: '-- Select Author(s) --' },
            'classification': { emptyLabel: 'Unclassified' },
            'work_title': { hideEmpty: true, placeholder: '-- Select Title(s) --' },
            'person_name': { hideEmpty: true, placeholder: '-- Select Person(s) --' },
            'person_role': { hideEmpty: true, placeholder: '-- Select Role(s) --' },
            'institution_name': { hideEmpty: true, placeholder: '-- Select Institution(s) --' },
            'institution_place': { hideEmpty: true, placeholder: '-- Select Place(s) --' },
            'event_name': { hideEmpty: true, placeholder: '-- Select Event(s) --' },
            'search_for_roles_in_expression': { hideEmpty: true, placeholder: '-- Select Role(s) --' },
            'search_for_roles_in_manifestation': { hideEmpty: true, placeholder: '-- Select Role(s) --' },
            'roles_related_to_visual_object': { hideEmpty: true, placeholder: '-- Select Role(s) --' },
            'roles_related_to_physical_object': { hideEmpty: true, placeholder: '-- Select Role(s) --' },
            'person_or_institution': { hideEmpty: true, placeholder: '-- Select Person/Institution --' },
            'type_of_visual_object': { hideEmpty: true, placeholder: '-- Select VO Type(s) --' },
            'type_of_physical_object': { hideEmpty: true, placeholder: '-- Select PO Type(s) --' },
            'visual_object_function': { hideEmpty: true, placeholder: '-- Select Function(s) --' },
            'visual_object_language': { hideEmpty: true, placeholder: '-- Select Language(s) --' },
            'visual_object_instrument': { hideEmpty: true, placeholder: '-- Select Instrument(s) --' },
            'visual_object_colour': { hideEmpty: true, placeholder: '-- Select Colour(s) --' },
            'owner': { hideEmpty: true, placeholder: '-- Select Owner(s) --' }
        }
        const options = optionsMap[field];
        const config = configMap[field] || {};
        const customSelect = createCustomMultiSelect(options, field, config);
        valuePlaceholder.appendChild(customSelect);
    }
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
        }
        
        renderValueSelector(field, valuePlaceholder);
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
            <option value="author">Author</option>
            <option value="person_or_institution">Select Person/Institution</option>
            <option value="classification">Classification of work</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="search_for_roles_in_expression">Search for roles in Expression</option>
        `;
    } else if (currentEntity === 'manifestation') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="author">Author</option>
            <option value="classification">Classification of work</option>
            <option value="person_or_institution">Select Person/Institution</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="place">Place</option>
            <option value="publication_date">Date</option>
            <option value="search_for_roles_in_manifestation">Search for roles in Manifestation</option>
            <option value="search_for_roles_in_expression">Search for roles in Expression</option>
        `;
    } else if (currentEntity === 'item') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="work_title">Title of the work</option>
            <option value="author">Author</option>
            <option value="classification">Classification of work</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language</option>
            <option value="place">Place</option>
            <option value="publication_date">Date</option>
            <option value="person_or_institution">Select Person/Institution</option>
            <option value="preservation_status">Preservation status</option>
            <option value="owner">Institution or person (owner)</option>
            <option value="material">Material</option>
            <option value="type_of_item">Type of Item</option>
            <option value="type_of_physical_object">Type of Physical Object</option>
            <option value="type_of_visual_object">Type of Visual Object</option>
            <option value="roles_related_to_visual_object">Roles related to Visual Object</option>
        `;
    } else if (currentEntity === 'person') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="person_name">Name</option>
            <option value="person_role">Role of the person</option>
            <option value="person_gender">Gender</option>
            <option value="person_dates">Dates the person lived</option>
        `;
    } else if (currentEntity === 'page') {
        // Pages currently have no specific filter fields — provide a placeholder
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
        `;
    } else if (currentEntity === 'visual_object') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="visual_object_transcription">Text search</option>
            <option value="proximity_text_search">Proximity text search</option>
            <option value="type_of_visual_object">Type of Visual Object</option>
            <option value="visual_object_function">Visual Object - Function</option>
            <option value="visual_object_language">Language of Visual Object</option>
            <option value="visual_object_instrument">Instrument</option>
            <option value="visual_object_colour">Colour of Visual Object</option>
            <option value="owner">Institution or person (owner)</option>
            <option value="person_or_institution">Select Person/Institution</option>
            <option value="work_title">Title of the work</option>
            <option value="author">Author of work</option>
            <option value="classification">Classification</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language of expression</option>
            <option value="place">Place of manifestation</option>
            <option value="publication_date">Date (date of manifestation)</option>
            <option value="roles_related_to_visual_object">Roles related to Visual Object</option>
        `;
    } else if (currentEntity === 'physical_object') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="physical_object_place">Place of Physical Object</option>
            <option value="physical_object_date">Date of Physical Object</option>
            <option value="owner">Institution or person (owner)</option>
            <option value="work_title">Title of the work</option>
            <option value="author">Author of work</option>
            <option value="classification">Classification</option>
            <option value="type_of_expression">Type of expression</option>
            <option value="language">Language of expression</option>
            <option value="place">Place of manifestation</option>
            <option value="publication_date">Date (date of manifestation)</option>
            <option value="roles_related_to_visual_object">Roles related to Visual Object</option>
            <option value="type_of_physical_object">Type of Physical Object</option>
            <option value="roles_related_to_physical_object">Roles related to Physical Object</option>
            <option value="person_or_institution">Select Person/Institution</option>
        `;
    } else if (currentEntity === 'institution') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="institution_name">Name of the institution</option>
            <option value="institution_place">Place of institution</option>
        `;
    } else if (currentEntity === 'event') {
        selectElement.innerHTML = `
            <option value="">-- Select Field --</option>
            <option value="event_name">Name of event</option>
        `;
    } else if (currentEntity === 'graphs') {
        selectElement.innerHTML = `<option value="">-- Not Applicable --</option>`;
    }
}

function updateFilterOptionsForProjects() {
    const projectSelect = document.getElementById('project-select');
    if (!projectSelect || !availableOptions) return;

    const selectedProjects = Array.from(projectSelect.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value)
        .filter(val => val !== '__SELECT_ALL__');

    if (selectedProjects.length === 0) {
        currentFilterOptions = availableOptions['__ALL__'] || {};
    } else if (selectedProjects.length === 1) {
        currentFilterOptions = availableOptions[selectedProjects[0]] || {};
    } else {
        const mergedOptions = {};
        const allKeys = new Set(Object.keys(availableOptions['__ALL__'] || {}));

        allKeys.forEach(key => {
            const mergedValues = new Set();
            selectedProjects.forEach(proj => {
                const projectOptions = availableOptions[proj]?.[key] || [];
                projectOptions.forEach(val => mergedValues.add(val));
            });
            mergedOptions[key] = Array.from(mergedValues).sort();
        });
        currentFilterOptions = mergedOptions;
    }

    document.querySelectorAll('.filter-row.sub-row').forEach(row => {
        const fieldSelect = row.querySelector('.field-select');
        const valuePlaceholder = row.querySelector('.value-placeholder');
        if (fieldSelect && valuePlaceholder) {
            renderValueSelector(fieldSelect.value, valuePlaceholder);
        }
    });
}

function handleEntityChange() {
    const entity = document.getElementById('entity-select').value;
    const filterRowsContainer = document.getElementById('filter-rows-container');
    const subRows = filterRowsContainer.querySelectorAll('.sub-row');
    const resultsContainer = document.getElementById('results-container');
    const graphContainer = document.getElementById('graph-container');
    const graphFiltersContainer = document.getElementById('graph-filters-container');

    subRows.forEach(row => row.remove());
    
    if (entity === 'graphs') {
        resultsContainer.style.display = 'none';
        graphContainer.style.display = 'block';
        graphFiltersContainer.style.display = 'block';
        filterRowsContainer.querySelector('.add-row-btn').style.display = 'none';
        setupGraphFilters();
        fetchAndRenderGraph();
    } else {
        resultsContainer.style.display = 'block';
        graphContainer.style.display = 'none';
        graphFiltersContainer.style.display = 'none';
        filterRowsContainer.querySelector('.add-row-btn').style.display = 'block';
        buildQueryAndFetch();
    }
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
        case 'event':
            return `<a href="#" class="event-link" data-event-id="${id}">${label}</a>`;
        case 'expression':
            return `<a href="#" class="expression-link" data-expression-id="${id}">${label}</a>`;
        case 'visual_object':
            return `<a href="#" class="vo-link" data-vo-id="${id}">${label}</a>`;
        case 'manifestation':
            return `<a href="#" class="manifestation-link" data-manifestation-id="${id}">${label}</a>`;
        case 'manifestation_volume':
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

function renderRelationshipCard(item) {
    const isOutgoing = item.direction === 'outgoing' || item.direction === 'transitive';
    const entityId = isOutgoing ? item.target_id : item.source_id;
    const entityType = isOutgoing ? item.target_type : item.source_type;
    const entityLabel = isOutgoing ? item.target_label : item.source_label;
    const cardData = isOutgoing ? item.target_card : item.source_card;

    if (!cardData) return '';

    const projectsHTML = (cardData.projects && cardData.projects.length > 0)
        ? `<div class="project-tags-container">${cardData.projects.map(p => `<span class="project-tag">${p}</span>`).join('')}</div>`
        : '';

    let contentHTML = '';
    let title = cardData.title || entityLabel;

    const entityTypeToDataAttr = {
        'work': 'data-work-id',
        'expression': 'data-expression-id',
        'manifestation': 'data-manifestation-id',
        'manifestation_volume': 'data-manifestation-volume-id',
        'item': 'data-item-id',
        'page': 'data-page-id',
        'visual_object': 'data-vo-id',
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
        : `data-${entityType.replace(/_/g, '-')}-id="${entityId}"`;

    switch (entityType) {
        case 'work':
            const authorsText = (cardData.authors && cardData.authors.length > 0)
                ? cardData.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Authors:</strong></p><div>${authorsText}</div>
                <p><strong>Classifications:</strong> ${cardData.classifications || '<em>None</em>'}</p>
            `;
            break;
        case 'expression':
            const primaryAuthorsText = (cardData.primary_authors && cardData.primary_authors.length > 0)
                ? cardData.primary_authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';

            let secondaryAuthorsHTML = '';
            if (cardData.secondary_authors && cardData.secondary_authors.length > 0) {
                const secondaryAuthorsText = cardData.secondary_authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('');
                secondaryAuthorsHTML = `<p><strong>Secondary Authors:</strong></p><div>${secondaryAuthorsText}</div>`;
            }

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
        case 'manifestation_volume':
            const cardAuthorsText = (cardData.authors && cardData.authors.length > 0)
                ? cardData.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
                : '<em>None</em>';
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
                <p><strong>Author:</strong></p><div>${cardAuthorsText}</div>
                <p><strong>Place:</strong> ${placeText}</p>
            `;
            break;
        case 'item':
            const itemAuthorsText = (cardData.authors && cardData.authors.length > 0)
                ? cardData.authors.map(a => {
                    if (a.type === 'person') {
                        return `<div>${a.name}${renderPersonDetails(a)}</div>`;
                    }
                    return `<div><a href="#" class="institution-link" data-institution-id="${a.id}">${a.name}</a></div>`;
                }).join('')
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
        case 'physical_object':
            contentHTML = `
                <h3 ${dataAttribute} title="${title}">${title}</h3>
                <p><strong>Type:</strong> ${cardData.type_of_physical_object || '<em>None</em>'}</p>
            `;
            break;
        case 'page':
            let pageContent = `<h3 ${dataAttribute} title="${title}">${title}</h3>`;
            if (cardData.Item) pageContent += `<p><strong>Item:</strong> ${cardData.Item}</p>`;
            if (cardData.Manifestation) pageContent += `<p><strong>Manifestation:</strong> ${cardData.Manifestation}</p>`;
            if (cardData.Publisher) pageContent += `<p><strong>Publisher:</strong> ${cardData.Publisher}</p>`;
            if (cardData['Unità materiale']) pageContent += `<p><strong>Unità materiale:</strong> ${cardData['Unità materiale']}</p>`;
            contentHTML = pageContent;
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
                ${projectsHTML}
            </div>
            ${contentHTML}
            ${renderHypothesisTags(cardData)}
        </div>
    `;
}

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
        currentDetailsData = await response.json();
        const data = currentDetailsData;

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

        let childSectionHTML = '';
        if (entityType === 'person') {
            let relatedEntitiesHTML = '';

            if (data.roles_with_entities) {
                const roles = Object.keys(data.roles_with_entities).sort();
                if (roles.length > 0) {
                    relatedEntitiesHTML += roles.map(role => {
                        const entities = data.roles_with_entities[role];
                        const initialLimit = 8;
                        const visibleEntities = entities.slice(0, initialLimit);

                        const cardsHTML = visibleEntities.map(entity => {
                            const cardItem = {
                                direction: 'outgoing',
                                target_id: entity.id,
                                target_type: entity.type,
                                target_label: entity.label,
                                target_card: entity.card
                            };
                            return renderRelationshipCard(cardItem);
                        }).join('');
                        
                        let loadMoreButtonHTML = '';
                        if (entities.length > initialLimit) {
                            loadMoreButtonHTML = `<div class="load-more-container">
                                <button class="load-more-btn" data-type="role" data-role="${role}" data-offset="${initialLimit}">Load More</button>
                            </div>`;
                        }

                        return `<div class="details-section">
                            <h3>${role} of:</h3>
                            <div class="cards-container">${cardsHTML}</div>
                            ${loadMoreButtonHTML}
                        </div>`;
                    }).join('');
                }
            }

            const personalRels = data.relationships.filter(r => r.group === 'personal');
            if (personalRels.length > 0) {
                const groupedPersonalRels = personalRels.reduce((acc, rel) => {
                    const label = rel.type;
                    if (!acc[label]) acc[label] = [];
                    acc[label].push(rel);
                    return acc;
                }, {});

                const personalRelKeys = Object.keys(groupedPersonalRels).sort();
                relatedEntitiesHTML += personalRelKeys.map(label => {
                    const rels = groupedPersonalRels[label];
                    const initialLimit = 8;
                    const visibleRels = rels.slice(0, initialLimit);
                    const cardsHTML = visibleRels.map(renderRelationshipCard).join('');

                    let loadMoreButtonHTML = '';
                    if (rels.length > initialLimit) {
                        loadMoreButtonHTML = `<div class="load-more-container">
                            <button class="load-more-btn" data-type="personal" data-label="${label}" data-offset="${initialLimit}">Load More</button>
                        </div>`;
                    }

                    return `<div class="details-section">
                        <h3>${label}:</h3>
                        <div class="cards-container">${cardsHTML}</div>
                        ${loadMoreButtonHTML}
                    </div>`;
                }).join('');
            }

            if (relatedEntitiesHTML) {
                childSectionHTML = `<div class="details-section"><h2>Related entities:</h2>${relatedEntitiesHTML}</div>`;
            }

        } else if (childRels.length > 0) {
            childSectionHTML = `<div class="details-section">
                <h3>Related entities:</h3>
                <div class="cards-container">${childRels.map(renderRelationshipCard).join('')}</div>
            </div>`;
        }

        let createdHypothesesHTML = '';
        if (entityType === 'person' && data.created_hypotheses && data.created_hypotheses.length > 0) {
            const personName = data[titleKey] || 'this person';
            const allHypotheses = data.created_hypotheses;
            const initialLimit = 2;
            const increment = 2;
            const visibleHypotheses = allHypotheses.slice(0, initialLimit);

            const hypothesisGroups = visibleHypotheses.map(hypo => {
                const allAboutEntities = hypo.about_entities;
                const innerInitialLimit = 8;
                const innerIncrement = 8;
                const visibleAboutEntities = allAboutEntities.slice(0, innerInitialLimit);

                const aboutCardsHTML = visibleAboutEntities.map(entity => {
                    const cardItem = {
                        direction: 'outgoing',
                        target_id: entity.id,
                        target_type: entity.type,
                        target_label: entity.label,
                        target_card: entity.card
                    };
                    return renderRelationshipCard(cardItem);
                }).join('');

                let innerLoadMoreButtonHTML = '';
                if (allAboutEntities.length > innerInitialLimit) {
                    innerLoadMoreButtonHTML = `<div class="load-more-container">
                        <button class="load-more-btn" data-type="hypo-cards" data-hypo-id="${hypo.hypothesis_id}" data-offset="${innerInitialLimit}" data-increment="${innerIncrement}">Load More</button>
                    </div>`;
                }

                return `<div class="hypothesis-group">
                    <h4>
                        <a href="#" class="hypothesis-link" data-hypothesis-id="${hypo.hypothesis_id}">
                            ${hypo.hypothesis_title}
                        </a>
                    </h4>
                    ${aboutCardsHTML ? `<div class="cards-container">${aboutCardsHTML}</div>${innerLoadMoreButtonHTML}` : '<p><em>This hypothesis is not linked to any specific entities.</em></p>'}
                </div>`;
            }).join('');

            let loadMoreButtonHTML = '';
            if (allHypotheses.length > initialLimit) {
                loadMoreButtonHTML = `<div class="load-more-container">
                    <button class="load-more-btn" data-type="hypo-list" data-offset="${initialLimit}" data-increment="${increment}">Load More</button>
                </div>`;
            }

            createdHypothesesHTML = `
                <div class="details-section">
                    <h3>Hypotheses made by ${personName}</h3>
                    <div class="hypothesis-groups-container">${hypothesisGroups}</div>
                    ${loadMoreButtonHTML}
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
        
        let otherRelationsHTML = '';
        if (entityType === 'person') {
            const relsByType = otherRels.reduce((acc, rel) => {
                if (!acc[rel.type]) acc[rel.type] = [];
                acc[rel.type].push(rel);
                return acc;
            }, {});

            const renderOrder = [
                { type: "person_has_name", label: "Name" },
                { type: "person_has_gender", label: "Gender" },
                { type: "person_has_birth_date", label: "Date of birth" },
                { type: "person_has_death_date", label: "Date of death" },
                { type: "person_has_description", label: "Description (Wikidata)" },
                { type: "person_member_of_institution", label: "Member of institution" },
                { type: "person_has_notes", label: "Additional notes" },
                { type: "person_has_wikidata_link", label: "Wikidata link" },
                { type: "person_has_wikidata_id", label: "Wikidata ID" },
                { type: "person_has_alias", label: "Also known as" }
            ];

            let detailsContent = renderOrder.map(item => {
                let rels = relsByType[item.type];
                if (!rels) return '';

                let valueStr = '';
                if (item.type === 'person_has_birth_date') {
                    const dateValues = rels.map(r => r.target_label);
                    const noteValues = (relsByType['person_has_birth_date_notes'] || []).map(r => r.target_label);
                    valueStr = [...dateValues, ...noteValues].filter(Boolean).join(' ');
                } else if (item.type === 'person_has_death_date') {
                    const dateValues = rels.map(r => r.target_label);
                    const noteValues = (relsByType['person_has_death_date_notes'] || []).map(r => r.target_label);
                    valueStr = [...dateValues, ...noteValues].filter(Boolean).join(' ');
                } else if (item.type === 'person_has_birth_date_notes' || item.type === 'person_has_death_date_notes') {
                    return '';
                } else {
                    valueStr = rels.map(rel => {
                        if (rel.target_type === 'institution') {
                            return createEntityLink(rel.target_id, rel.target_type, rel.target_label);
                        }
                        return linkify(rel.target_label);
                    }).join('; ');
                }
                
                return `<p><strong>${item.label}:</strong> ${valueStr}</p>`;
            }).join('');

            if (detailsContent) {
                otherRelationsHTML = `<div class="details-section">
                    <h3>Details about person</h3>
                    ${detailsContent}
                </div>`;
            }

        } else if (otherRels.length > 0) {
            otherRelationsHTML = `<div class="details-section">
                <h3>Details about ${entityType}</h3>
                ${otherRels.map(rel => {
                    const isOutgoing = rel.direction === 'outgoing';
                    const label = relationshipLabelMap.get(rel.type) || rel.type;
                    const relatedEntityId = isOutgoing ? rel.target_id : rel.source_id;
                    const relatedEntityLabel = isOutgoing ? rel.target_label : rel.source_label;
                    const relatedEntityType = isOutgoing ? rel.target_type : rel.source_type;
                    const cardData = isOutgoing ? rel.target_card : rel.source_card;

                    let valueHTML;

                    if (rel.type === 'page_has_digital_representation' && data.projects && data.projects.length > 0) {
                        const projectName = data.projects[0]; // Use the first project associated with the entity
                        const imageName = relatedEntityLabel;
                        const imageUrl = `${API_BASE_URL}/images/${encodeURIComponent(projectName)}/${encodeURIComponent(imageName)}`;
                        
                        valueHTML = `<a href="${imageUrl}" class="image-popup-link" data-src="${imageUrl}">${imageName}</a>`;
                    } else {
                        valueHTML = createEntityLink(relatedEntityId, relatedEntityType, relatedEntityLabel);
                        if (relatedEntityType === 'person' && cardData) {
                            valueHTML += renderPersonDetails(cardData);
                        }
                    }
                    
                    return `<p><strong>${label}:</strong> ${valueHTML}</p>`;
                }).join('')}
            </div>`;
        }
        
        const entityTagHTML = `<div class="details-entity-tag entity-tag ${entityTypeToCssClass[entityType] || ''}">${entityType.replace(/_/g, ' ')}</div>`;

        let pagesSectionHTML = '';
        if (entityType === 'item' && data.pages && data.pages.length > 0) {
            
            const doesVoMatchRules = (vo, rules) => {
                if (!rules || rules.length === 0) return true;

                const checkSingleRuleMatch = (rule) => {
                    if (rule.field === 'roles_related_to_visual_object') {
                        return rule.values.some(roleName => {
                            switch (roleName) {
                                case 'Owner': return (vo.owners || []).length > 0;
                                case 'Inscriber': return (vo.inscribers || []).length > 0;
                                case 'Sender': return (vo.senders || []).length > 0;
                                case 'Recipient': return (vo.recipients || []).length > 0;
                                default: return false;
                            }
                        });
                    } else if (rule.field === 'person_or_institution') {
                        const allVOPeople = [
                            ...(vo.owners || []),
                            ...(vo.inscribers || []),
                            ...(vo.senders || []),
                           
                            ...(vo.recipients || [])
                        ].map(name => name.toLowerCase());
                        return rule.values.some(personName => allVOPeople.includes(personName.toLowerCase()));
                    }
                    return false;
                };

                let finalMatch = checkSingleRuleMatch(rules[0]);
                for (let i = 1; i < rules.length; i++) {
                    const logic = rules[i - 1].logic;
                    const nextMatch = checkSingleRuleMatch(rules[i]);
                    if (logic === 'and') {
                        finalMatch = finalMatch && nextMatch;
                    } else if (logic === 'or') {
                        finalMatch = finalMatch || nextMatch;
                    } else if (logic === 'not') {
                        finalMatch = finalMatch && !nextMatch;
                    }
                }
                return finalMatch;
            };

            const renderPageBalls = (pages) => {
                if (!pages || pages.length === 0) return '';
                return pages.map(page => {
                    const voCircles = (page.visual_objects || []).map((vo, index) => {
                        return `<span class="vo-circle" title="${vo.vo_name}" data-vo-id="${vo.vo_id}">${index + 1}</span>`;
                    }).join('');
            
                    let pageClasses = ['page-ball', 'page-toggle'];
                    const hasPO = page.has_physical_objects;
                    const hasVO = page.has_visual_objects;
                    const hasScan = page.has_digital_representation;
            
                    if (hasPO) pageClasses.push('has-po');
                    if (hasVO) pageClasses.push('has-vo');
                    if (hasScan) pageClasses.push('has-scan');
            
                    return `<div class="page-ball-wrapper">
                                <div class="${pageClasses.join(' ')}" data-page-id="${page.page_id}" title="${page.page_label}">
                                    <span>${page.page_label}</span>
                                </div>
                                <div class="vo-list" style="display: none;">${voCircles || '<em>No visual objects.</em>'}</div>
                            </div>`;
                }).join('');
            };

            const legendHTML = `
                <div class="pages-legend">
                    <strong>Legend:</strong>
                    <div class="legend-item"><div class="page-ball"></div><span>Empty Page</span></div>
                    <div class="legend-item"><div class="page-ball has-po"></div><span>Has Physical Object</span></div>
                    <div class="legend-item"><div class="page-ball has-vo"></div><span>Has Visual Object (Thick Border)</span></div>
                    <div class="legend-item"><div class="page-ball has-scan"></div><span>Has Scan (Crossed)</span></div>
                    <div class="legend-item"><div class="page-ball has-po has-vo has-scan"></div><span>All Combined</span></div>
                </div>
            `;

            const allPageListItems = renderPageBalls(data.pages);
            const allPagesSection = `
                <div class="details-section">
                    <h3>All Pages</h3>
                    <div class="page-balls-container">${allPageListItems}</div>
                </div>`;

            if (voRoleRules && voRoleRules.length > 0) {
                const filteredPages = data.pages
                    .map(page => ({
                        ...page,
                        visual_objects: (page.visual_objects || []).filter(vo => doesVoMatchRules(vo, voRoleRules))
                    }))
                    .filter(page => page.visual_objects.length > 0);

                if (filteredPages.length > 0) {
                    const filteredPageListItems = renderPageBalls(filteredPages);
                    pagesSectionHTML = `
                        ${legendHTML}
                        <div class="details-section">
                            <h3>Pages Satisfying Filter</h3>
                            <div class="page-balls-container">${filteredPageListItems}</div>
                        </div>
                        ${allPagesSection}`;
                } else {
                    pagesSectionHTML = `
                        ${legendHTML}
                        <div class="details-section">
                            <h3>Pages Satisfying Filter</h3>
                            <p><em>No pages contain visual objects matching the current filter.</em></p>
                        </div>
                        ${allPagesSection}`;
                }
            } else {
                pagesSectionHTML = `${legendHTML}${allPagesSection}`;
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

        const projectsHTML = (data.projects && data.projects.length > 0) 
            ? data.projects.map(p => `<span class="project-tag">${p}</span>`).join('') 
            : '';

        let pageDetailsHTML = '';
        if (entityType === 'page' && data.card) {
            const card = data.card;
            let detailsInner = '';
            if (card.Item) detailsInner += `<p><strong>Item:</strong> ${card.Item}</p>`;
            if (card.Manifestation) detailsInner += `<p><strong>Manifestation:</strong> ${card.Manifestation}</p>`;
            if (card.Publisher) detailsInner += `<p><strong>Publisher:</strong> ${card.Publisher}</p>`;
            
            if (detailsInner) {
                pageDetailsHTML = `<div class="details-section">
                    <h3>Page Details</h3>
                    ${detailsInner}
                </div>`;
            }
        }

        const pageContent = `
            <div class="details-header">
                <div class="details-header-main">
                    ${entityTagHTML}
                    <h1>${data[titleKey]}</h1>
                </div>
                <div class="details-header-projects">
                    ${projectsHTML}
                </div>
            </div>
            ${hypothesisHTML}
            ${parentCardsHTML}
            ${pageDetailsHTML}
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

function setupGraphFilters() {
    const container = document.getElementById('graph-filters-container');
    if (container.querySelector('#graph-type-select')) {
        return;
    }
    container.innerHTML = '';

    const typeSelectorRow = document.createElement('div');
    typeSelectorRow.className = 'filter-row';
    typeSelectorRow.innerHTML = `
        <label for="graph-type-select" style="font-weight: bold;">Graph Type:</label>
        <select id="graph-type-select">
            <option value="general">General</option>
            <option value="mentions">Graph about mentions</option>
            <option value="person_centric">Person Centric</option>
        </select>
    `;
    container.appendChild(typeSelectorRow);

    const generalFiltersContainer = document.createElement('div');
    generalFiltersContainer.id = 'general-graph-filters';
    container.appendChild(generalFiltersContainer);

    const mentionsFiltersContainer = document.createElement('div');
    mentionsFiltersContainer.id = 'mentions-graph-filters';
    mentionsFiltersContainer.style.display = 'none';
    container.appendChild(mentionsFiltersContainer);

    const personCentricFiltersContainer = document.createElement('div');
    personCentricFiltersContainer.id = 'person-centric-graph-filters';
    personCentricFiltersContainer.style.display = 'none';
    container.appendChild(personCentricFiltersContainer);


    const generalRow = document.createElement('div');
    generalRow.className = 'filter-row';
    const entityTypes = ['Work', 'Expression', 'Manifestation', 'Item', 'Person', 'Institution', 'Physical Object'];
    const entitySelect = createCustomMultiSelect(entityTypes, 'graph_entities', {
        placeholder: '-- Select Entity Types --',
        hideEmpty: true
    });
    entitySelect.id = 'graph-entity-select';

    const relationships = [
        'is_expression_of_work', 'is_manifestation_of_expression', 'is_item_of_manifestation', 
        'manifestation_has_volume', 'work_authored_by', 'item_contains_physical_object', 
        'visual_object_inscribed_by_person', 'visual_object_sent_by_person',
        'visual_object_received_by_person', 'visual_object_owned_by_person'
    ];
    const relationshipSelect = createCustomMultiSelect(relationships, 'graph_relations', {
        placeholder: '-- Select Relationships --',
        hideEmpty: true
    });
    relationshipSelect.id = 'graph-relationship-select';

    const workTitleSelect = createCustomMultiSelect(currentFilterOptions.work_titles, 'graph_work_titles', {
        placeholder: '-- Select Title of the Work --',
        hideEmpty: true
    });
    workTitleSelect.id = 'graph-work-title-select';
    
    generalRow.appendChild(entitySelect);
    generalRow.appendChild(relationshipSelect);
    generalRow.appendChild(workTitleSelect);
    generalFiltersContainer.appendChild(generalRow);

    const mentionsRow = document.createElement('div');
    mentionsRow.className = 'filter-row';
    const allEntityTypes = [
        'work', 'expression', 'manifestation', 'manifestation_volume', 'item', 'page', 
        'visual_object', 'place', 'person', 'physical_object', 'event', 
        'abstract_character', 'institution'
    ];
    const mentionsEntitySelect = createCustomMultiSelect(allEntityTypes, 'mentions_entities', {
        placeholder: '-- Select Entity Types --',
        hideEmpty: true
    });
    mentionsEntitySelect.id = 'mentions-entity-select';

    const mentionDirections = ['Mentioning', 'Mentioned by'];
    const mentionDirectionSelect = createCustomMultiSelect(mentionDirections, 'mentions_directions', {
        placeholder: '-- Select Mention Direction --',
        hideEmpty: true
    });
    mentionDirectionSelect.id = 'mentions-direction-select';

    const mentionsWorkTitleSelect = createCustomMultiSelect(currentFilterOptions.work_titles, 'mentions_work_titles', {
        placeholder: '-- Select Title of the Work (Optional) --',
        hideEmpty: true
    });
    mentionsWorkTitleSelect.id = 'mentions-work-title-select';

    mentionsRow.appendChild(mentionsEntitySelect);
    mentionsRow.appendChild(mentionDirectionSelect);
    mentionsRow.appendChild(mentionsWorkTitleSelect);
    mentionsFiltersContainer.appendChild(mentionsRow);

    const personCentricRow = document.createElement('div');
    personCentricRow.className = 'filter-row';
    const personCentricEntityTypes = ['Work', 'Manifestation', 'Person', 'Item', 'Page', 'Visual_Object'];
    const personCentricEntitySelect = createCustomMultiSelect(personCentricEntityTypes, 'person_centric_entities', {
        placeholder: '-- Select Entity Types --',
        hideEmpty: true
    });
    personCentricEntitySelect.id = 'person-centric-entity-select';

    const personCentricRelationships = [
        'work_authored_by', 'manifestation_edited_by_person', 'Mentioning', 
        'Mentioned by', 'visual_object_inscribed_by_person', 'visual_object_sent_by_person',
        'visual_object_received_by_person', 'visual_object_owned_by_person'
    ];
    const personCentricRelationshipSelect = createCustomMultiSelect(personCentricRelationships, 'person_centric_relations', {
        placeholder: '-- Select Relationships --',
        hideEmpty: true
    });
    personCentricRelationshipSelect.id = 'person-centric-relationship-select';

    const personNameSelect = createCustomMultiSelect(currentFilterOptions.all_people, 'person_centric_names', {
        placeholder: '-- Select Person Name (Optional) --',
        hideEmpty: true
    });
    personNameSelect.id = 'person-centric-name-select';

    personCentricRow.appendChild(personCentricEntitySelect);
    personCentricRow.appendChild(personCentricRelationshipSelect);
    personCentricRow.appendChild(personNameSelect);
    personCentricFiltersContainer.appendChild(personCentricRow);


    document.getElementById('graph-type-select').addEventListener('change', (e) => {
        const selectedType = e.target.value;
        generalFiltersContainer.style.display = 'none';
        mentionsFiltersContainer.style.display = 'none';
        personCentricFiltersContainer.style.display = 'none';

        if (selectedType === 'general') {
            generalFiltersContainer.style.display = 'block';
        } else if (selectedType === 'mentions') {
            mentionsFiltersContainer.style.display = 'block';
        } else if (selectedType === 'person_centric') {
            personCentricFiltersContainer.style.display = 'block';
        }
        fetchAndRenderGraph();
    });
}

async function fetchAndRenderGraph() {
    const graphContent = document.getElementById('graph-content');
    graphContent.innerHTML = '<p>Loading graph data...</p>';

    const projectSelect = document.getElementById('project-select');
    const projects = Array.from(projectSelect.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value)
        .filter(val => val !== '__SELECT_ALL__');

    const graphType = document.getElementById('graph-type-select').value;
    let query = {
        projects: projects,
        graph_type: graphType
    };
    let isValid = false;

    if (graphType === 'general') {
        const entitySelect = document.getElementById('graph-entity-select');
        const entityTypes = entitySelect ? Array.from(entitySelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value.toLowerCase().replace(/ /g, '_'))
            .filter(val => val !== '__select_all__') : [];

        const relationshipSelect = document.getElementById('graph-relationship-select');
        const relationships = relationshipSelect ? Array.from(relationshipSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];
        
        const workTitleSelect = document.getElementById('graph-work-title-select');
        const workTitles = workTitleSelect ? Array.from(workTitleSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];

        if (projects.length > 0 && (entityTypes.length > 0 || workTitles.length > 0) && relationships.length > 0) {
            isValid = true;
            query.general_filters = {
                entity_types: entityTypes.length > 0 ? entityTypes : ['work', 'expression', 'manifestation', 'item', 'manifestation_volume', 'page', 'person'],
                relationships: relationships,
                work_titles: workTitles.length > 0 ? workTitles : null
            };
        } else {
             graphContent.innerHTML = '<p>Please select at least one project, relationship, and either entity types or work titles to render the graph.</p>';
        }

    } else if (graphType === 'mentions') {
        const entitySelect = document.getElementById('mentions-entity-select');
        const entityTypes = entitySelect ? Array.from(entitySelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];

        const directionSelect = document.getElementById('mentions-direction-select');
        const mentionDirections = directionSelect ? Array.from(directionSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];

        const workTitleSelect = document.getElementById('mentions-work-title-select');
        const workTitles = workTitleSelect ? Array.from(workTitleSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];

        if (projects.length > 0 && entityTypes.length > 0 && mentionDirections.length > 0) {
            isValid = true;
            query.mentions_filters = {
                entity_types: entityTypes,
                mention_directions: mentionDirections,
                work_titles: workTitles.length > 0 ? workTitles : null
            };
        } else {
            graphContent.innerHTML = '<p>Please select at least one project, entity type, and mention direction to render the graph.</p>';
        }
    } else if (graphType === 'person_centric') {
        const entitySelect = document.getElementById('person-centric-entity-select');
        const entityTypes = entitySelect ? Array.from(entitySelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value.toLowerCase().replace(/ /g, '_'))
            .filter(val => val !== '__select_all__') : [];

        const relationshipSelect = document.getElementById('person-centric-relationship-select');
        const relationships = relationshipSelect ? Array.from(relationshipSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => {
                if (cb.value === 'Mentioning') return 'person_is_mentioning';
                if (cb.value === 'Mentioned by') return 'person_is_mentioned_by';
                return cb.value;
            })
            .filter(val => val !== '__select_all__') : [];
        
        const personNameSelect = document.getElementById('person-centric-name-select');
        const personNames = personNameSelect ? Array.from(personNameSelect.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value)
            .filter(val => val !== '__select_all__') : [];

        if (projects.length > 0 && entityTypes.length > 0 && relationships.length > 0) {
            isValid = true;
            query.person_centric_filters = {
                entity_types: entityTypes,
                relationships: relationships,
                person_names: personNames.length > 0 ? personNames : null
            };
        } else {
            graphContent.innerHTML = '<p>Please select at least one project, entity type, and relationship to render the graph.</p>';
        }
    }


    if (!isValid) {
        document.getElementById('api-payload').textContent = '{}';
        document.getElementById('api-endpoint').textContent = '';
        return;
    }

    document.getElementById('api-endpoint').textContent = `${API_BASE_URL}/graphs/search`;
    document.getElementById('api-payload').textContent = JSON.stringify(query, null, 2);
    try {
        const response = await fetch(`${API_BASE_URL}/graphs/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(query)
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        currentGraphData = data;
        renderGraph(data, graphType);

    } catch (error) {
        graphContent.innerHTML = `<p style="color: red;">Error fetching graph data: ${error.message}</p>`;
    }
}

function updateEdge(edgeEl, labelEl, sourcePos, targetPos, nodeRadius) {
    const dx = targetPos.x - sourcePos.x;
    const dy = targetPos.y - sourcePos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    edgeEl.style.width = `${dist - nodeRadius}px`;
    
    edgeEl.style.left = `${sourcePos.x + nodeRadius}px`;
    edgeEl.style.top = `${sourcePos.y + nodeRadius}px`;
    edgeEl.style.transform = `rotate(${angle}deg)`;
    labelEl.style.left = `${sourcePos.x + dx / 2 + nodeRadius}px`;
    labelEl.style.top = `${sourcePos.y + dy / 2 + nodeRadius}px`;
};

function attachNodeDragHandlers(nodeEl, nodeId) {
    let activeNode = null;
    let dragOffset = { x: 0, y: 0 };
    const nodeRadius = 80 / 2;

    function onNodeDrag(e) {
        if (!activeNode) return;
        const graphWrapper = document.getElementById('graph-wrapper');
        const transform = graphWrapper.style.transform;
        const match = /translate\(([-0-9.]+)px, ([-0-9.]+)px\) scale\(([-0-9.]+)\)/.exec(transform);
        const panX = match ? parseFloat(match[1]) : 0;
        const panY = match ? parseFloat(match[2]) : 0;
        const scale = match ? parseFloat(match[3]) : 1;

        const newX = (e.clientX - panX - dragOffset.x) / scale;
        const newY = (e.clientY - panY - dragOffset.y) / scale;
        positions[activeNode] = { x: newX, y: newY };
        
        const draggedNodeEl = nodeElements.get(activeNode);
        if (draggedNodeEl) {
            draggedNodeEl.style.left = `${newX}px`;
            draggedNodeEl.style.top = `${newY}px`;
        }

        edgeElements.forEach(edge => {
            if (edge.sourceId === activeNode || edge.targetId === activeNode) {
                updateEdge(edge.element, edge.label, positions[edge.sourceId], positions[edge.targetId], nodeRadius);
            }
        });
    }

    function onNodeRelease() {
        activeNode = null;
        document.removeEventListener('mousemove', onNodeDrag);
        document.removeEventListener('mouseup', onNodeRelease);
    }

    nodeEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeNode = nodeId;
        const nodePos = positions[activeNode];
        
        const graphWrapper = document.getElementById('graph-wrapper');
        const transform = graphWrapper.style.transform;
        const match = /translate\(([-0-9.]+)px, ([-0-9.]+)px\) scale\(([-0-9.]+)\)/.exec(transform);
        const panX = match ? parseFloat(match[1]) : 0;
        const panY = match ? parseFloat(match[2]) : 0;
        const scale = match ? parseFloat(match[3]) : 1;

        dragOffset.x = e.clientX - nodePos.x * scale - panX;
        dragOffset.y = e.clientY - nodePos.y * scale - panY;
        document.addEventListener('mousemove', onNodeDrag);
        document.addEventListener('mouseup', onNodeRelease);
    });
}

function runCollisionDetection(nodesToCollide) {
    const nodeSize = 80;
    const nodeRadius = nodeSize / 2;

    for (let i = 0; i < 15; i++) {
        for (let j = 0; j < nodesToCollide.length; j++) {
            for (let k = j + 1; k < nodesToCollide.length; k++) {
                const nodeAId = nodesToCollide[j].id;
                const nodeBId = nodesToCollide[k].id;

                if (!positions[nodeAId] || !positions[nodeBId]) continue;

                const dx = positions[nodeAId].x - positions[nodeBId].x;
                const dy = positions[nodeAId].y - positions[nodeBId].y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const minDistance = nodeSize + 40;

                if (distance < minDistance) {
                    const overlap = (minDistance - distance) / 2;
                    const shiftX = (dx / distance) * overlap;
                    const shiftY = (dy / distance) * overlap;
                    positions[nodeAId].x += shiftX;
                    positions[nodeAId].y += shiftY;
                    positions[nodeBId].x -= shiftX;
                    positions[nodeBId].y -= shiftY;

                    const nodeAEl = nodeElements.get(nodeAId);
                    const nodeBEl = nodeElements.get(nodeBId);
                    if (nodeAEl) {
                        nodeAEl.style.left = `${positions[nodeAId].x}px`;
                        nodeAEl.style.top = `${positions[nodeAId].y}px`;
                    }
                    if (nodeBEl) {
                        nodeBEl.style.left = `${positions[nodeBId].x}px`;
                        nodeBEl.style.top = `${positions[nodeBId].y}px`;
                    }
                }
            }
        }
    }
    const nodeIds = new Set(nodesToCollide.map(n => n.id));
    edgeElements.forEach(edge => {
        if (nodeIds.has(edge.sourceId) || nodeIds.has(edge.targetId)) {
            updateEdge(edge.element, edge.label, positions[edge.sourceId], positions[edge.targetId], nodeRadius);
        }
    });
}

function renderGraph(data, graphType) {
    const graphContent = document.getElementById('graph-content');
    graphContent.innerHTML = '';

    if (!data.nodes || data.nodes.length === 0) {
        graphContent.innerHTML = '<p>No data to display for the selected filters.</p>';
        return;
    }

    const graphWrapper = document.createElement('div');
    graphWrapper.id = 'graph-wrapper';
    graphContent.appendChild(graphWrapper);

    nodeElements = new Map();
    edgeElements = [];
    positions = {};

    const nodes = data.nodes;
    const edges = data.edges.filter(edge => edge.direction === 'outgoing');
    const nodeSize = 80;
    const nodeRadius = nodeSize / 2;

    const findComponents = () => {
        const adj = new Map();
        nodes.forEach(node => adj.set(node.id, []));
        edges.forEach(edge => {
            adj.get(edge.source)?.push(edge.target);
            adj.get(edge.target)?.push(edge.source);
        });

        const components = [];
        const visited = new Set();
        nodes.forEach(node => {
            if (!visited.has(node.id)) {
                const component = [];
                const q = [node.id];
                visited.add(node.id);
                while (q.length > 0) {
                    const u = q.shift();
                    component.push(u);
                    adj.get(u)?.forEach(v => {
                        if (!visited.has(v)) {
                            visited.add(v);
                            q.push(v);
                        }
                    });
                }
                components.push(component);
            }
        });
        return components;
    };

    const runLayout = (componentNodes, boundingBox) => {
        const componentNodeMap = new Map(componentNodes.map(n => [n.id, n]));
        const componentEdges = edges.filter(e => componentNodeMap.has(e.source) && componentNodeMap.has(e.target));
        
        const entityTypeOrder = ['person', 'work', 'expression', 'manifestation', 'manifestation_volume', 'item', 'page_summary', 'page'];
        const laneCount = entityTypeOrder.length;
        const laneWidth = boundingBox.width / laneCount;

        componentNodes.forEach(node => {
            const typeIndex = entityTypeOrder.indexOf(node.entity_type);
            const laneX = (typeIndex >= 0) ? typeIndex * laneWidth : (Math.random() * boundingBox.width);
            positions[node.id] = {
                x: boundingBox.x + laneX + (Math.random() - 0.5) * (laneWidth * 0.8),
                y: boundingBox.y + Math.random() * boundingBox.height
            };
        });

        const iterations = 300;
        const k_attract = 0.02;
        const k_repel = 20000;
        const ideal_length = 150;
        let temperature = boundingBox.width / 10;

        for (let i = 0; i < iterations; i++) {
            const displacements = {};
            componentNodes.forEach(node => displacements[node.id] = { dx: 0, dy: 0 });

            for (let j = 0; j < componentNodes.length; j++) {
                for (let k = j + 1; k < componentNodes.length; k++) {
                    const nodeA = componentNodes[j];
                    const nodeB = componentNodes[k];
                    const dx = positions[nodeA.id].x - positions[nodeB.id].x;
                    const dy = positions[nodeA.id].y - positions[nodeB.id].y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    const force = k_repel / (distance * distance);
                    const ddx = (dx / distance) * force;
                    const ddy = (dy / distance) * force;
                    displacements[nodeA.id].dx += ddx;
                    displacements[nodeA.id].dy += ddy;
                    displacements[nodeB.id].dx -= ddx;
                    displacements[nodeB.id].dy -= ddy;
                }
            }

            componentEdges.forEach(edge => {
                const dx = positions[edge.source].x - positions[edge.target].x;
                const dy = positions[edge.source].y - positions[edge.target].y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = k_attract * (distance - ideal_length);
                const ddx = (dx / distance) * force;
                const ddy = (dy / distance) * force;
                displacements[edge.source].dx -= ddx;
                displacements[edge.source].dy -= ddy;
                displacements[edge.target].dx += ddx;
                displacements[edge.target].dy += ddy;
            });

            componentNodes.forEach(node => {
                const { dx, dy } = displacements[node.id];
                const displacementMag = Math.sqrt(dx * dx + dy * dy) || 1;
                const cappedDx = (dx / displacementMag) * Math.min(displacementMag, temperature);
                const cappedDy = (dy / displacementMag) * Math.min(displacementMag, temperature);
                positions[node.id].x += cappedDx;
                positions[node.id].y += cappedDy;
            });

            temperature *= (1 - (i / iterations));
        }
    };

    const components = findComponents();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const cols = Math.ceil(Math.sqrt(components.length));
    const boxWidth = 1000;
    const boxHeight = 700;
    components.forEach((comp, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const boundingBox = {
            x: col * boxWidth,
            y: row * boxHeight,
            width: boxWidth,
            height: boxHeight
        };
        const componentNodes = comp.map(nodeId => nodeMap.get(nodeId));
        runLayout(componentNodes, boundingBox);
    });

    runCollisionDetection(nodes);

    let scale = 0.5;
    let panX = 0;
    let panY = 0;

    const updateTransform = () => {
        graphWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    };
    updateTransform();

    nodes.forEach(node => {
        const nodeEl = document.createElement('div');
        nodeEl.className = `graph-node ${node.entity_type}`;
        const words = node.title.split(' ');
        const truncatedTitle = words.slice(0, 7).join(' ') + (words.length > 7 ? '...' : '');
        nodeEl.textContent = truncatedTitle;
        nodeEl.title = node.title;
        
        const hasLongWord = truncatedTitle.split(/[\s-]/).some(word => word.length > 10);
        if (hasLongWord) {
            nodeEl.classList.add('small-text');
        }

        nodeEl.dataset.entityId = node.id;
        nodeEl.dataset.entityType = node.entity_type;

        nodeEl.style.left = `${positions[node.id].x}px`;
        nodeEl.style.top = `${positions[node.id].y}px`;
        graphWrapper.appendChild(nodeEl);
        nodeElements.set(node.id, nodeEl);
    });

    edges.forEach(edge => {
        const sourcePos = positions[edge.source];
        const targetPos = positions[edge.target];
        if (!sourcePos || !targetPos) return;
        const edgeEl = document.createElement('div');
        edgeEl.className = 'graph-edge';

        if (graphType === 'mentions' || graphType === 'person_centric') {
            if (edge.type.endsWith('_is_mentioning')) {
                edgeEl.classList.add('mentioning');
            } else if (edge.type.endsWith('_is_mentioned_by')) {
                edgeEl.classList.add('mentioned-by');
            }
        }

        const labelEl = document.createElement('div');
        labelEl.className = 'graph-edge-label';
        labelEl.textContent = edge.type;
        graphWrapper.appendChild(edgeEl);
        graphWrapper.appendChild(labelEl);
        updateEdge(edgeEl, labelEl, sourcePos, targetPos, nodeRadius);
        edgeElements.push({ element: edgeEl, label: labelEl, sourceId: edge.source, targetId: edge.target });
    });

    nodeElements.forEach((nodeEl, nodeId) => {
        attachNodeDragHandlers(nodeEl, nodeId);
    });

    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    graphContent.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('graph-node')) return;
        e.preventDefault();
        isPanning = true;
        panStart.x = e.clientX - panX;
        panStart.y = e.clientY - panY;
        document.addEventListener('mousemove', onPan);
        document.addEventListener('mouseup', onPanEnd);
    });

    function onPan(e) {
        if (!isPanning) return;
        panX = e.clientX - panStart.x;
        panY = e.clientY - panStart.y;
        updateTransform();
    }

    function onPanEnd() {
        isPanning = false;
        document.removeEventListener('mousemove', onPan);
        document.removeEventListener('mouseup', onPanEnd);
    }

    graphContent.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = graphContent.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const zoomFactor = 1.1;
        const oldScale = scale;
        if (e.deltaY < 0) {
            scale *= zoomFactor;
        } else {
            scale /= zoomFactor;
        }
        scale = Math.min(Math.max(0.1, scale), 5);
        panX = mouseX - (mouseX - panX) * (scale / oldScale);
        panY = mouseY - (mouseY - panY) * (scale / oldScale);
        updateTransform();
    });
}


function handleAuthorClick(authorId) {
    const endpoint = `${API_BASE_URL}/details/person/${encodeURIComponent(authorId)}`;
    renderEntityDetailsPage(endpoint, 'person_name', 'person');
}

function handleAcClick(acId) {
    const endpoint = `${API_BASE_URL}/details/abstract_character/${encodeURIComponent(acId)}`;
    renderEntityDetailsPage(endpoint, 'ac_name', 'abstract_character');
}

function handleEventClick(eventId) {
    const endpoint = `${API_BASE_URL}/details/event/${encodeURIComponent(eventId)}`;
    renderEntityDetailsPage(endpoint, 'event_name', 'event');
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
        'roles_related_to_visual_object',
        'person_or_institution'
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
        currentFilterOptions = availableOptions['__ALL__'] || {};

        const projectOptions = currentFilterOptions.projects?.map(p => ({ label: p, value: p })) || [];
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
                <option value="page">Page</option>
                <option value="person">Person</option>
                <option value="graphs">Graphs</option>
                <option value="visual_object">Visual Object</option>
                <option value="physical_object">Physical Object</option>
                <option value="institution">Institution</option>
                <option value="event">Event</option>
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
            const eventLink = e.target.closest('.event-link, [data-event-id]');
            const expressionTarget = e.target.closest('.expression-link, [data-expression-id]:not(a)');
            const voTarget = e.target.closest('.vo-link, .vo-circle, [data-vo-id]:not(a)');
            const manifestationTarget = e.target.closest('.manifestation-link, [data-manifestation-id]:not(a)');
            const manifestationVolumeTarget = e.target.closest('.manifestation-volume-link, [data-manifestation-volume-id]:not(a)');
            const placeLink = e.target.closest('.place-link');
            const itemTarget = e.target.closest('.item-link, [data-item-id]:not(a)');
            const institutionTarget = e.target.closest('.institution-link, [data-institution-id]:not(a)');
            const pageTarget = e.target.closest('.page-link, [data-page-id]:not(a)');
            const physicalObjectTarget = e.target.closest('.physical-object-link, [data-physical-object-id]:not(a)');
            const hypothesisTarget = e.target.closest('.hypothesis-link, .hypothesis-tag');
            const pagesMainToggle = e.target.closest('.pages-main-toggle');
            const showMoreBtn = e.target.closest('.show-more-pages-btn');
            const loadMoreBtn = e.target.closest('.load-more-btn');
            const imagePopupLink = e.target.closest('.image-popup-link');
            
            if (imagePopupLink) {
                e.preventDefault();
                const imageUrl = imagePopupLink.dataset.src;
                
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML = `
                    <div class="modal-content">
                        <span class="modal-close">&times;</span>
                        <img src="${imageUrl}" alt="Digital Representation">
                    </div>
                `;
                
                document.body.appendChild(modal);

                modal.addEventListener('click', (event) => {
                    if (event.target === modal || event.target.classList.contains('modal-close')) {
                        document.body.removeChild(modal);
                    }
                });
            }
            else if (loadMoreBtn) {
                e.preventDefault();
                const type = loadMoreBtn.dataset.type;
                const offset = parseInt(loadMoreBtn.dataset.offset, 10);
                const increment = parseInt(loadMoreBtn.dataset.increment, 10) || 8;
                const cardsContainer = loadMoreBtn.closest('.details-section, .hypothesis-group').querySelector('.cards-container');
            
                if (type === 'role') {
                    const role = loadMoreBtn.dataset.role;
                    const allEntities = currentDetailsData.roles_with_entities[role];
                    const nextEntities = allEntities.slice(offset, offset + increment);
                    
                    const newCardsHTML = nextEntities.map(entity => {
                        const cardItem = {
                            direction: 'outgoing',
                            target_id: entity.id,
                            target_type: entity.type,
                            target_label: entity.label,
                            target_card: entity.card
                        };
                        return renderRelationshipCard(cardItem);
                    }).join('');
            
                    cardsContainer.insertAdjacentHTML('beforeend', newCardsHTML);
            
                    const newOffset = offset + nextEntities.length;
                    if (newOffset >= allEntities.length) {
                        loadMoreBtn.parentElement.remove();
                    } else {
                        loadMoreBtn.dataset.offset = newOffset;
                    }
                } else if (type === 'personal') {
                    const label = loadMoreBtn.dataset.label;
                    const allRels = currentDetailsData.relationships.filter(r => r.group === 'personal' && r.type === label);
                    const nextRels = allRels.slice(offset, offset + increment);
                    const newCardsHTML = nextRels.map(renderRelationshipCard).join('');
                    
                    cardsContainer.insertAdjacentHTML('beforeend', newCardsHTML);
            
                    const newOffset = offset + nextRels.length;
                    if (newOffset >= allRels.length) {
                        loadMoreBtn.parentElement.remove();
                    } else {
                        loadMoreBtn.dataset.offset = newOffset;
                    }
                } else if (type === 'hypo-list') {
                    const allHypotheses = currentDetailsData.created_hypotheses;
                    const nextHypotheses = allHypotheses.slice(offset, offset + increment);
                    
                    const newGroupsHTML = nextHypotheses.map(hypo => {
                        const allAboutEntities = hypo.about_entities;
                        const innerInitialLimit = 8;
                        const innerIncrement = 8;
                        const visibleAboutEntities = allAboutEntities.slice(0, innerInitialLimit);
            
                        const aboutCardsHTML = visibleAboutEntities.map(entity => {
                            const cardItem = {
                                direction: 'outgoing',
                                target_id: entity.id,
                                target_type: entity.type,
                                target_label: entity.label,
                                target_card: entity.card
                            };
                            return renderRelationshipCard(cardItem);
                        }).join('');

                        let innerLoadMoreButtonHTML = '';
                        if (allAboutEntities.length > innerInitialLimit) {
                            innerLoadMoreButtonHTML = `<div class="load-more-container">
                                <button class="load-more-btn" data-type="hypo-cards" data-hypo-id="${hypo.hypothesis_id}" data-offset="${innerInitialLimit}" data-increment="${innerIncrement}">Load More</button>
                            </div>`;
                        }

                        return `<div class="hypothesis-group">
                            <h4>
                                <a href="#" class="hypothesis-link" data-hypothesis-id="${hypo.hypothesis_id}">
                                    ${hypo.hypothesis_title}
                                </a>
                            </h4>
                            ${aboutCardsHTML ? `<div class="cards-container">${aboutCardsHTML}</div>${innerLoadMoreButtonHTML}` : '<p><em>This hypothesis is not linked to any specific entities.</em></p>'}
                        </div>`;
                    }).join('');

                    const groupsContainer = loadMoreBtn.parentElement.previousElementSibling;
                    groupsContainer.insertAdjacentHTML('beforeend', newGroupsHTML);
            
                    const newOffset = offset + nextHypotheses.length;
                    if (newOffset >= allHypotheses.length) {
                        loadMoreBtn.parentElement.remove();
                    } else {
                        loadMoreBtn.dataset.offset = newOffset;
                    }
                } else if (type === 'hypo-cards') {
                    const hypoId = loadMoreBtn.dataset.hypoId;
                    const hypothesis = currentDetailsData.created_hypotheses.find(h => h.hypothesis_id === hypoId);
                    const allEntities = hypothesis.about_entities;
                    const nextEntities = allEntities.slice(offset, offset + increment);
            
                    const newCardsHTML = nextEntities.map(entity => {
                        const cardItem = {
                            direction: 'outgoing',
                            target_id: entity.id,
                            target_type: entity.type,
                            target_label: entity.label,
                            target_card: entity.card
                        };
                        return renderRelationshipCard(cardItem);
                    }).join('');
            
                    cardsContainer.insertAdjacentHTML('beforeend', newCardsHTML);
            
                    const newOffset = offset + nextEntities.length;
                    if (newOffset >= allEntities.length) {
                        loadMoreBtn.parentElement.remove();
                    } else {
                        loadMoreBtn.dataset.offset = newOffset;
                    }
                }
            }
            else if (showMoreBtn) {
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
            } else if (e.target.closest('.page-toggle')) {
                const pageBall = e.target.closest('.page-toggle');
                const voList = pageBall.parentElement.querySelector('.vo-list');
                if (voList) {
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
            } else if (eventLink) {
                e.preventDefault();
                handleEventClick(eventLink.dataset.eventId);
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
            } else if (manifestationVolumeTarget && manifestationVolumeTarget.dataset.manifestationVolumeId) {
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

        document.body.addEventListener('dblclick', (e) => {
            const graphNodeTarget = e.target.closest('.graph-node');
            const pageBallTarget = e.target.closest('.page-ball');

            if (pageBallTarget) {
                e.preventDefault();
                const pageId = pageBallTarget.dataset.pageId;
                if (pageId) {
                    handlePageClick(pageId);
                }
            } else if (graphNodeTarget) {
                e.preventDefault();
                const { entityId, entityType } = graphNodeTarget.dataset;
                switch (entityType) {
                    case 'work':
                        handleWorkClick(entityId);
                        break;
                    case 'expression':
                        handleExpressionClick(entityId);
                        break;
                    case 'manifestation':
                        handleManifestationClick(entityId);
                        break;
                    case 'manifestation_volume':
                        handleManifestationVolumeClick(entityId);
                        break;
                    case 'item':
                        handleItemClick(entityId);
                        break;
                    case 'page':
                        handlePageClick(entityId);
                        break;
                    case 'person':
                        handleAuthorClick(entityId);
                        break;
                    case 'institution':
                        handleInstitutionClick(entityId);
                        break;
                    case 'physical_object':
                        handlePhysicalObjectClick(entityId);
                        break;
                    case 'visual_object':
                        handleVisualObjectClick(entityId);
                        break;
                    case 'event':
                        handleEventClick(entityId);
                        break;
                    case 'abstract_character':
                        handleAcClick(entityId);
                        break;
                }
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
