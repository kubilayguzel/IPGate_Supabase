// public/js/client-portal/RenderHelper.js

export class RenderHelper {
    constructor(state) {
        this.state = state; // main.js'den gelen merkezi veri havuzuna erişim
    }

    // Ortak Tarih Formatlayıcı
    formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        } catch { return '-'; }
    }

    // ==========================================
    // DAVA TABLOSU RENDER
    // ==========================================
    renderDavaTable(dataSlice, startIndex = 0) {
        const tbody = document.getElementById('dava-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!dataSlice || dataSlice.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Kayıt yok.</td></tr>';
            return;
        }

        dataSlice.forEach((r, index) => {
            const badge = (r.suitStatus || '').toLowerCase().includes('devam') ? 'info' : 'secondary';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${startIndex + index + 1}</td>
                <td>${r.caseNo || '-'}</td>
                <td><a href="#" class="dava-detail-link" data-suit-id="${r.id}">${r.title || 'Dava'}</a></td>
                <td>${r.subjectAssetTitle || '-'}</td>
                <td>${r.court || '-'}</td>
                <td>${r.opposingParty || '-'}</td>
                <td>${this.formatDate(r.openingDate)}</td>
                <td><span class="badge badge-${badge}">${r.suitStatus || 'Devam Ediyor'}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ==========================================
    // İTİRAZ TABLOSU RENDER (Gelişmiş Akordeonlu)
    // ==========================================
    renderObjectionTable(dataSlice, startIndex = 0) {
        const tbody = document.getElementById('dava-itiraz-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!dataSlice || dataSlice.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">Henüz itiraz kaydı bulunmamaktadır.</td></tr>';
            return;
        }

        dataSlice.forEach((row, index) => {
            const parentIndex = startIndex + index + 1;
            const tr = document.createElement('tr');
            
            const originBucket = (row.origin || 'TÜRKPATENT').toUpperCase().includes('TURK') ? 'TÜRKPATENT' : 'YURTDISI';
            tr.setAttribute('data-origin', originBucket);

            const imgHtml = row.brandImageUrl 
                ? `<img src="${row.brandImageUrl}" alt="marka" class="brand-thumb">` 
                : '<img src="https://placehold.co/100x100?text=Yok" alt="yok" class="brand-thumb">';
            
            const hasChildren = row.childrenData && row.childrenData.length > 0;
            const iconHtml = hasChildren ? '<i class="fas fa-chevron-right mr-2"></i>' : '';
            const uniqueAccordionId = `itiraz-accordion-${row.recordId}-${row.id}`;

            if (hasChildren) {
                tr.classList.add('accordion-header-row');
                tr.setAttribute('data-toggle', 'collapse');
                tr.setAttribute('data-target', `#${uniqueAccordionId}`);
            }

            tr.innerHTML = `
                <td>${iconHtml}${parentIndex}</td>
                <td class="col-origin">${originBucket}</td>
                <td class="text-center">${imgHtml}</td>
                <td><a href="#" class="portfolio-detail-link" data-item-id="${row.recordId}">${row.title}</a></td>
                <td>${row.transactionTypeName}</td>
                <td>${row.applicationNumber}</td>
                <td>${row.applicantName}</td>
                <td>${row.bulletinDate || '-'}</td>
                <td>${row.bulletinNo || '-'}</td>
                <td>${row.epatsDate || '-'}</td>
                <td><span class="badge badge-${row.statusBadge || 'warning'}">${row.statusText}</span></td>
                <td>${this.renderDocsCell(row.allParentDocs)}</td>
            `;
            
            tbody.appendChild(tr);

            // Alt (Child) İşlemler varsa akordeon satırını ekle
            if (hasChildren) {
                const detailRow = document.createElement('tr');
                detailRow.setAttribute('data-origin', originBucket);
                
                const childrenHtml = row.childrenData.map((child, idx) => {
                    let childDate = child.transaction_date || child.created_at ? this.formatDate(child.transaction_date || child.created_at) : '-';
                    const typeObj = this.state.transactionTypes.get(String(child.transaction_type_id));
                    const typeName = typeObj?.alias || typeObj?.name || `İşlem ${child.transaction_type_id}`;
                    
                    return `<tr>
                        <td>${parentIndex}.${idx + 1}</td>
                        <td>${typeName}</td>
                        <td>${childDate}</td>
                        <td>${this.renderDocsCell(child.transaction_documents)}</td>
                    </tr>`;
                }).join('');

                detailRow.innerHTML = `
                <td colspan="12" class="p-0">
                    <div class="collapse" id="${uniqueAccordionId}">
                        <table class="table mb-0 accordion-table bg-light" style="font-size:0.9em;">
                            <thead><tr><th>#</th><th>İşlem Tipi</th><th>İşlem Tarihi</th><th>Evraklar</th></tr></thead>
                            <tbody>${childrenHtml}</tbody>
                        </table>
                    </div>
                </td>`;
                tbody.appendChild(detailRow);
            }
        });
    }

    // ==========================================
    // ORTAK EVRAK/PDF LİNK OLUŞTURUCU
    // ==========================================
    renderDocsCell(docs) {
        if (!docs || docs.length === 0) return '<span class="text-muted">-</span>';
        return docs.map(doc => {
            let iconClass = 'fas fa-file-pdf';
            let titleText = doc.document_name || doc.name || doc.fileName || 'Belge';
            let iconColor = '#dc3545'; 
            let badgeHtml = '';

            const docType = doc.document_type || doc.type || '';

            if (docType === 'opposition_petition') { iconClass = 'fas fa-gavel'; titleText = 'Karşı Taraf İtiraz Dilekçesi'; iconColor = '#ffc107'; }
            else if (docType === 'official_document') { iconClass = 'fas fa-file-signature'; titleText = 'Resmi Yazı'; iconColor = '#17a2b8'; }
            else if (docType === 'epats_document') { 
                iconClass = 'fas fa-file-invoice'; 
                titleText = `ePats: ${doc.evrakNo || titleText}`; 
                iconColor = '#007bff'; 
            }
            else if (docType === 'task_document' || doc.isTaskDoc) { iconClass = 'fas fa-file-alt'; titleText = 'Görev Belgesi: ' + titleText; iconColor = '#6c757d'; }

            const url = doc.document_url || doc.fileUrl || doc.downloadURL || doc.url;
            if (!url) return '';
            
            return `<a href="${url}" target="_blank" title="${titleText}" style="color:${iconColor}; text-decoration:none; margin-right:8px; font-size:1.2em; display:inline-block;"><i class="${iconClass}"></i>${badgeHtml}</a>`;
        }).filter(Boolean).join('') || '<span class="text-muted">-</span>';
    }
}