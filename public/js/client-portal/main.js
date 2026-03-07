// public/js/client-portal/main.js

import { supabase } from '../../supabase-config.js';
import { AuthManager } from './AuthManager.js';
import { PortfolioManager } from './PortfolioManager.js';
import { TaskManager } from './TaskManager.js';
import { InvoiceManager } from './InvoiceManager.js';
import { ContractManager } from './ContractManager.js';
import { RenderHelper } from './RenderHelper.js';
import Pagination from '../pagination.js';

class ClientPortalController {
    constructor() {
        // Yöneticiler (Managers)
        this.authManager = new AuthManager();
        this.portfolioManager = new PortfolioManager();
        this.taskManager = new TaskManager();
        this.invoiceManager = new InvoiceManager();
        this.contractManager = new ContractManager();
        this.renderHelper = new RenderHelper(this.state);

        // Merkezi Veri Havuzu (Global State)
        this.state = {
            selectedClientId: 'ALL',
            linkedClients: [],
            countries: new Map(),
            transactionTypes: new Map(),
            
            // Ham Veriler
            portfolios: [],
            suits: [],
            tasks: [],
            invoices: [],
            contracts: [],
            
            // Filtrelenmiş Veriler
            filteredPortfolios: [],
            filteredSuits: [],
            filteredTasks: [],
            filteredInvoices: [],
            filteredContracts: [],

            // Sayfalama Objeleri
            paginations: {
                portfolio: null,
                suit: null,
                task: null,
                invoice: null,
                contract: null,
                objection: null
            },

            // Kolon Filtreleri
            activeColumnFilters: {}
        };

        // Dışa açılması gereken HTML içi inline fonksiyonları bağla
        this.exposeGlobalFunctions();
    }

    // ==========================================
    // 1. BAŞLATMA (INIT) VE YETKİLENDİRME
    // ==========================================
    async init() {
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show('Portal Hazırlanıyor', 'Verileriniz güvenle getiriliyor...');
        }

        const isAuth = await this.authManager.initSession();
        if (!isAuth) {
            window.location.href = 'index.html';
            return;
        }

        // Temel sözlükleri (Ülkeler, İşlem Tipleri) çek
        await this.loadDictionaries();

        // Kullanıcı ve Müşteri Bilgilerini Çek
        const user = this.authManager.user;
        document.getElementById('userName').textContent = user.user_metadata?.display_name || user.email;
        document.getElementById('welcomeUserName').textContent = user.user_metadata?.display_name || user.email;
        document.getElementById('userAvatar').textContent = (user.user_metadata?.display_name || user.email || 'U').charAt(0).toUpperCase();

        const clients = await this.authManager.getLinkedClients();
        this.state.linkedClients = clients;

        this.renderClientSelector();

        // Tema ve Event Listener'ları kur
        this.initTheme();
        this.setupEventListeners();

        // Seçili müşteriye göre tüm verileri yükle
        await this.loadAllData();
    }

    async loadDictionaries() {
        try {
            // Ülkeler
            const { data: countryData } = await supabase.from('common').select('data').eq('id', 'countries').single();
            if (countryData && countryData.data && Array.isArray(countryData.data.list)) {
                countryData.data.list.forEach(c => this.state.countries.set(c.code, c.name));
            }
            
            // İşlem Tipleri
            const { data: txData } = await supabase.from('transaction_types').select('*');
            if (txData) {
                txData.forEach(t => this.state.transactionTypes.set(String(t.id), t));
            }
        } catch (e) {
            console.warn("Sözlükler yüklenemedi:", e);
        }
    }

    renderClientSelector() {
        const clients = this.state.linkedClients;
        if (clients.length <= 1) return;

        const dropdownMenu = document.getElementById('clientDropdownMenu');
        dropdownMenu.innerHTML = `<a class="dropdown-item" href="#" onclick="window.switchClient('ALL')"><strong>Tümü</strong></a><div class="dropdown-divider"></div>`;
        
        clients.forEach(c => {
            dropdownMenu.innerHTML += `<a class="dropdown-item" href="#" onclick="window.switchClient('${c.id}')">${c.name}</a>`;
        });
        
        document.getElementById('clientSelectorContainer').style.display = 'block';

        const savedClient = sessionStorage.getItem('selectedClientSession');
        if (!savedClient) {
            const modalList = document.getElementById('clientSelectionList');
            modalList.innerHTML = `<button type="button" class="list-group-item list-group-item-action font-weight-bold" onclick="window.switchClient('ALL', true)">Tüm Müşterileri Göster</button>`;
            clients.forEach(c => {
                modalList.innerHTML += `<button type="button" class="list-group-item list-group-item-action" onclick="window.switchClient('${c.id}', true)">${c.name}</button>`;
            });
            $('#clientSelectionModal').modal('show');
        } else {
            this.state.selectedClientId = savedClient;
            this.updateClientNameDisplay();
        }
    }

    updateClientNameDisplay() {
        let nameText = 'Tüm Müşteriler';
        if (this.state.selectedClientId !== 'ALL') {
            const client = this.state.linkedClients.find(c => c.id === this.state.selectedClientId);
            if (client) nameText = client.name;
        }
        document.getElementById('currentClientName').textContent = nameText;
    }

    // ==========================================
    // 2. VERİ YÜKLEME VE FİLTRELEME
    // ==========================================
    async loadAllData() {
        if (window.SimpleLoadingController && !document.getElementById('simple-loading-overlay')) {
            window.SimpleLoadingController.show('Veriler Yükleniyor', 'Analizler hazırlanıyor...');
        }

        try {
            // Hedef müşteri listesini belirle
            let targetIds = [];
            if (this.state.selectedClientId === 'ALL') {
                targetIds = this.state.linkedClients.map(c => c.id);
            } else {
                targetIds = [this.state.selectedClientId];
            }

            if (targetIds.length === 0) {
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
                return; // Bağlı firma yoksa boş döner
            }

            // Tüm verileri paralel olarak (Aynı anda) çek!
            const [portfolios, suits, tasks, invoices, contracts] = await Promise.all([
                this.portfolioManager.getPortfolios(targetIds),
                this.portfolioManager.getSuits(targetIds),
                // TaskManager'a portföy ID'lerini de veriyoruz ki markaya ait işleri bulsun
                this.portfolioManager.getPortfolios(targetIds).then(p => this.taskManager.getTasks(targetIds, p.map(x => x.id))),
                this.invoiceManager.getInvoices(targetIds),
                this.contractManager.getContracts(targetIds)
            ]);

            // Ham verileri state'e kaydet
            this.state.portfolios = portfolios;
            this.state.suits = suits;
            this.state.tasks = tasks;
            this.state.invoices = invoices;
            this.state.contracts = contracts;

            // Filtreleri uygula ve ekrana çiz
            this.applyAllFilters();
            this.updateDashboardCounts();

        } catch (error) {
            console.error("Veri yükleme hatası:", error);
        } finally {
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    applyAllFilters() {
        this.filterPortfolios();
        this.filterTasks();
        this.filterInvoices();
        this.filterContracts();
        this.filterSuits();
        this.prepareAndRenderObjections();
    }

    updateDashboardCounts() {
        document.getElementById('dashPortfolio').textContent = this.state.portfolios.length;
        
        let pendingTasks = 0;
        let unpaidInvoices = 0;

        this.state.tasks.forEach(t => {
            if (t.status === 'awaiting_client_approval' || t.status === 'pending') pendingTasks++;
        });

        this.state.invoices.forEach(i => {
            if (i.status === 'unpaid') unpaidInvoices++;
        });

        document.getElementById('dashPendingApprovals').textContent = pendingTasks;
        document.getElementById('dashUnpaidInvoices').textContent = unpaidInvoices;

        // İç sekmelerdeki sayaçlar
        document.getElementById('taskCount-marka-total').textContent = pendingTasks;
        document.getElementById('taskCount-pending-approval').textContent = pendingTasks;
    }

    // ==========================================
    // 3. RENDER (EKRANA ÇİZME) FONKSİYONLARI
    // ==========================================
    
    // PORTFÖY FİLTRELEME VE RENDER
    filterPortfolios() {
        const searchVal = (document.getElementById('portfolioSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('portfolioDurumFilter')?.value || 'TÜMÜ';
        const menseVal = document.getElementById('menseFilter')?.value || 'TÜRKPATENT';

        let filtered = this.state.portfolios.filter(item => {
            if (item.transactionHierarchy === 'child') return false;

            // Menşe
            const originRaw = (item.origin || 'TÜRKPATENT').toUpperCase();
            const isTurk = originRaw.includes('TURK');
            if (menseVal === 'TÜRKPATENT' && !isTurk) return false;
            if (menseVal === 'YURTDISI' && isTurk) return false;

            // Metin Arama
            if (searchVal) {
                const searchable = `${item.title} ${item.applicationNumber} ${item.registrationNumber}`.toLowerCase();
                if (!searchable.includes(searchVal)) return false;
            }

            // Durum
            if (statusVal !== 'TÜMÜ') {
                if (!(item.status || '').toLowerCase().includes(statusVal.toLowerCase())) return false;
            }

            return true;
        });

        this.state.filteredPortfolios = filtered;

        // Pagination
        if (!this.state.paginations.portfolio) {
            this.state.paginations.portfolio = new Pagination({
                itemsPerPage: 10,
                containerId: 'markaPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderPortfolioTable(this.state.filteredPortfolios.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.portfolio.update(filtered.length);
        this.renderPortfolioTable(filtered.slice(0, 10), 0);
    }

    // DAVA FİLTRELEME VE RENDER
    filterSuits() {
        // İleride arama kutusu eklenirse buraya eklenebilir
        this.state.filteredSuits = this.state.suits;
        
        if (!this.state.paginations.suit) {
            this.state.paginations.suit = new Pagination({
                itemsPerPage: 10,
                containerId: 'davaPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderHelper.renderDavaTable(this.state.filteredSuits.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.suit.update(this.state.filteredSuits.length);
        this.renderHelper.renderDavaTable(this.state.filteredSuits.slice(0, 10), 0);
    }

    // İTİRAZ (OBJECTION) VERİSİ HAZIRLAMA VE RENDER
    async prepareAndRenderObjections() {
        const REQUEST_RESULT_STATUS = {
            '24': 'Eksiklik Bildirimi', '28': 'Kabul', '29': 'Kısmi Kabul', '30': 'Ret',
            '31': 'B.S - Kabul', '32': 'B.S - Kısmi Kabul','33': 'B.S - Ret',
            '34': 'İ.S - Kabul', '35': 'İ.S - Kısmi Kabul','36': 'İ.S - Ret',
            '50': 'Kabul', '51': 'Kısmi Kabul', '52': 'Ret'
        };

        const PARENT_TYPES = ['7', '19', '20'];
        
        // İtiraz görevlerini ayır
        const objectionTasks = this.state.tasks.filter(t => PARENT_TYPES.includes(String(t.taskType)));
        
        if (objectionTasks.length === 0) {
            this.renderHelper.renderObjectionTable([]);
            return;
        }

        // İlgili markaların ID'lerini topla
        const ipRecordIds = [...new Set(objectionTasks.map(t => t.relatedIpRecordId).filter(Boolean))];
        
        // Supabase'den bu markaların "TÜM İŞLEMLERİNİ" (transactions) tek seferde çek
        const { data: transactionsData } = await supabase
            .from('transactions')
            .select('*, transaction_documents(*)')
            .in('ip_record_id', ipRecordIds);

        const allTransactions = transactionsData || [];
        const rows = [];

        objectionTasks.forEach(task => {
            const ipRecord = this.state.portfolios.find(p => p.id === task.relatedIpRecordId) || {};
            const taskTxs = allTransactions.filter(tx => tx.ip_record_id === task.relatedIpRecordId);
            
            // Parent Transaction Bul
            let parentTx = task.details?.triggeringTransactionId 
                ? taskTxs.find(tx => String(tx.id) === String(task.details.triggeringTransactionId))
                : taskTxs.filter(tx => String(tx.transaction_type_id) === String(task.taskType)).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

            if (!parentTx) {
                parentTx = { id: 'virt-'+task.id, transaction_type_id: task.taskType, created_at: task.createdAt, isVirtual: true };
            }

            // Statü Rengi ve Metni
            let computedStatus = 'Karar Bekleniyor';
            let badgeColor = 'secondary';
            const rr = parentTx.request_result;
            
            if (rr && REQUEST_RESULT_STATUS[String(rr)]) {
                computedStatus = REQUEST_RESULT_STATUS[String(rr)];
                if (computedStatus.includes('Ret')) badgeColor = 'danger';
                else if (computedStatus.includes('Kabul')) badgeColor = 'success';
                else badgeColor = 'info';
            } else if ((task.status || '').includes('awaiting')) {
                computedStatus = 'Onay Bekliyor';
                badgeColor = 'warning';
            }

            // Alt işlemleri bul
            const children = parentTx.isVirtual ? [] : taskTxs.filter(tx => tx.transaction_hierarchy === 'child' && tx.parent_id === parentTx.id);

            // Dökümanlar
            const parentDocs = parentTx.transaction_documents || [];

            rows.push({
                id: task.id,
                recordId: task.relatedIpRecordId,
                origin: ipRecord.origin,
                brandImageUrl: ipRecord.brandImageUrl,
                title: ipRecord.title || task.recordTitle,
                transactionTypeName: task.taskTypeDisplay,
                applicationNumber: ipRecord.applicationNumber,
                applicantName: task.details?.applicantName || 'Müvekkil',
                bulletinDate: task.details?.brandInfo?.opposedMarkBulletinDate,
                bulletinNo: task.details?.brandInfo?.opposedMarkBulletinNo,
                epatsDate: parentTx.created_at,
                statusText: computedStatus,
                statusBadge: badgeColor,
                allParentDocs: parentDocs,
                childrenData: children
            });
        });

        this.state.filteredObjections = rows;

        // Sayfalama
        if (!this.state.paginations.objection) {
            this.state.paginations.objection = new Pagination({
                itemsPerPage: 10,
                containerId: 'davaItirazPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderHelper.renderObjectionTable(this.state.filteredObjections.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.objection.update(rows.length);
        this.renderHelper.renderObjectionTable(rows.slice(0, 10), 0);
    }

    renderPortfolioTable(dataSlice, startIndex) {
        const tbody = document.querySelector('#marka-list tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Kayıt bulunamadı.</td></tr>`;
            return;
        }

        dataSlice.forEach((item, index) => {
            const actualIndex = startIndex + index;
            const row = document.createElement('tr');
            
            const originRaw = (item.origin || 'TÜRKPATENT').toUpperCase();
            const originDisplay = originRaw.includes('TURK') ? 'TÜRKPATENT' : (item.country || 'Yurtdışı');
            
            const childRecords = this.state.portfolios.filter(p => p.parentId === item.id);
            const isInternational = childRecords.length > 0;

            const imgHtml = item.brandImageUrl ? `<img src="${item.brandImageUrl}" class="brand-thumb">` : '-';
            const appDate = this.formatDate(item.applicationDate);
            const renDate = this.formatDate(item.renewalDate);

            // Durum Rengi
            let badgeClass = 'secondary';
            const st = (item.status || '').toLowerCase();
            if (st.includes('tescil') || st.includes('registered')) badgeClass = 'success';
            else if (st.includes('başvuru') || st.includes('filed')) badgeClass = 'primary';
            else if (st.includes('red') || st.includes('rejected')) badgeClass = 'danger';
            else if (st.includes('itiraz')) badgeClass = 'warning';

            row.innerHTML = `
                <td>${isInternational ? '<i class="fas fa-chevron-right mr-2"></i>' : ''}${actualIndex + 1}</td>
                <td class="col-origin">${originDisplay}</td>
                <td class="col-sample text-center">${imgHtml}</td>
                <td><a href="#" class="portfolio-detail-link" data-item-id="${item.id}">${item.title}</a></td>
                <td>${item.applicationNumber}</td>
                <td>${item.registrationNumber}</td>
                <td>${appDate}</td>
                <td>${renDate}</td> 
                <td><span class="badge badge-${badgeClass}">${item.status || 'Bilinmiyor'}</span></td>
                <td>${item.classes}</td>
            `;

            if (isInternational) {
                row.classList.add('accordion-header-row');
                row.setAttribute('data-toggle', 'collapse');
                row.setAttribute('data-target', `#accordion-yurtdisi-${item.id}`);
            }

            tbody.appendChild(row);

            // Child satırlar
            if (isInternational) {
                const detailRow = document.createElement('tr');
                const childHtml = childRecords.map((child, cIdx) => {
                    const childAppDate = this.formatDate(child.applicationDate);
                    const childCountry = this.state.countries.get(child.country) || child.country || 'Bilinmiyor';
                    return `<tr>
                        <td>${actualIndex+1}.${cIdx+1}</td>
                        <td>${childCountry}</td>
                        <td>${child.applicationNumber}</td>
                        <td>${childAppDate}</td>
                        <td>${this.formatDate(child.renewalDate)}</td>
                        <td><span class="badge badge-secondary">${child.status || 'Bilinmiyor'}</span></td>
                        <td>${child.classes}</td>
                    </tr>`;
                }).join('');

                detailRow.innerHTML = `
                <td colspan="10" class="p-0">
                    <div class="collapse" id="accordion-yurtdisi-${item.id}">
                        <table class="table mb-0 accordion-table bg-light">
                            <thead><tr><th>#</th><th>Ülke</th><th>Başvuru No</th><th>Başvuru T.</th><th>Yenileme T.</th><th>Durum</th><th>Sınıflar</th></tr></thead>
                            <tbody>${childHtml}</tbody>
                        </table>
                    </div>
                </td>`;
                tbody.appendChild(detailRow);
            }
        });
    }

    // FATURA FİLTRELEME VE RENDER
    filterInvoices() {
        const searchVal = (document.getElementById('invoiceSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('invoiceDurumFilter')?.value || 'TÜMÜ';

        let filtered = this.state.invoices.filter(inv => {
            if (searchVal) {
                const s = `${inv.invoiceNo} ${inv.taskTitle} ${inv.applicationNumber}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }
            if (statusVal !== 'TÜMÜ' && inv.status !== statusVal) return false;
            return true;
        });

        this.state.filteredInvoices = filtered;

        if (!this.state.paginations.invoice) {
            this.state.paginations.invoice = new Pagination({
                itemsPerPage: 10, containerId: 'invoices-pagination-container',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderInvoicesTable(this.state.filteredInvoices.slice(start, start + perPage));
                }
            });
        }
        
        this.state.paginations.invoice.update(filtered.length);
        this.renderInvoicesTable(filtered.slice(0, 10));
    }

    renderInvoicesTable(dataSlice) {
        const tbody = document.querySelector('#invoices table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Kayıt bulunamadı.</td></tr>`;
            return;
        }

        dataSlice.forEach(inv => {
            let statusText = inv.status;
            let badgeClass = 'secondary';
            if (inv.status === 'paid') { statusText = 'Ödendi'; badgeClass = 'success'; }
            else if (inv.status === 'unpaid') { statusText = 'Ödenmedi'; badgeClass = 'danger'; }
            else if (inv.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; badgeClass = 'warning'; }

            const formatArr = (arr) => {
                if (!arr || arr.length === 0) return '0 TRY';
                return arr.map(x => `${x.amount} ${x.currency}`).join(' + ');
            };

            const row = `<tr>
                <td class="font-weight-bold">${inv.invoiceNo}</td>
                <td>#${inv.taskId}</td>
                <td>${inv.applicationNumber}</td>
                <td>${this.formatDate(inv.createdAt)}</td>
                <td>${inv.taskTitle}</td>
                <td>${inv.officialFee.amount} ${inv.officialFee.currency}</td>
                <td>${inv.serviceFee.amount} ${inv.serviceFee.currency}</td>
                <td class="font-weight-bold text-primary">${formatArr(inv.totalAmount)}</td>
                <td><span class="badge badge-${badgeClass}">${statusText}</span></td>
                <td><button class="btn btn-sm btn-outline-primary"><i class="fas fa-download"></i></button></td>
            </tr>`;
            tbody.innerHTML += row;
        });
    }

    // VEKALET FİLTRELEME VE RENDER
    filterContracts() {
        const searchVal = (document.getElementById('contractsSearchText')?.value || '').toLowerCase().trim();
        
        let filtered = this.state.contracts.filter(doc => {
            if (searchVal) {
                const s = `${doc.type} ${doc.countryName} ${doc.ownerName}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }
            return true;
        });

        this.state.filteredContracts = filtered;

        if (!this.state.paginations.contract) {
            this.state.paginations.contract = new Pagination({
                itemsPerPage: 10, containerId: 'contractsPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderContractsTable(this.state.filteredContracts.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.contract.update(filtered.length);
        this.renderContractsTable(filtered.slice(0, 10), 0);
    }

    renderContractsTable(dataSlice, startIndex) {
        const tbody = document.getElementById('contractsTableBody');
        const noMsg = document.getElementById('noContractsMessage');
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            noMsg.style.display = 'block';
            return;
        }
        noMsg.style.display = 'none';

        dataSlice.forEach((doc, index) => {
            const btn = doc.url ? `<a href="${doc.url}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="fas fa-eye"></i> İncele</a>` : `<span class="badge badge-secondary">Dosya Yok</span>`;
            tbody.innerHTML += `
                <tr>
                    <td>${startIndex + index + 1}</td>
                    <td class="font-weight-bold text-primary"><i class="fas fa-file-alt mr-2 text-muted"></i>${doc.type}</td>
                    <td>${doc.countryName || '-'}</td>
                    <td>${this.formatDate(doc.validityDate)}</td>
                    <td class="text-center">${btn}</td>
                </tr>
            `;
        });
    }

    // İŞLERİM (TASKS) FİLTRELEME
    filterTasks() {
        const searchVal = (document.getElementById('taskSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('taskStatusFilter')?.value || 'TÜMÜ';
        
        // Aktif alt sekme tipini bul
        const activeSubCard = document.querySelector('.detail-card-link.active-list-type');
        const taskTypeFilter = activeSubCard ? activeSubCard.dataset.taskType : 'pending-approval';

        let filtered = this.state.tasks.filter(t => {
            // Durum
            if (statusVal !== 'TÜMÜ' && t.status !== statusVal) return false;
            
            // Metin Arama
            if (searchVal) {
                const s = `${t.title} ${t.appNo} ${t.recordTitle}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }

            // Kategori (Onay Bekleyen vs)
            const isDava = String(t.taskType) === '49' || (t.title || '').toLowerCase().includes('dava');
            
            if (taskTypeFilter === 'pending-approval') {
                return !isDava && t.status === 'awaiting_client_approval' && String(t.taskType) !== '20' && String(t.taskType) !== '22';
            } else if (taskTypeFilter === 'completed-tasks') {
                return !isDava && t.status !== 'awaiting_client_approval';
            } else if (taskTypeFilter === 'bulletin-watch') {
                return String(t.taskType) === '20';
            } else if (taskTypeFilter === 'renewal-approval') {
                return String(t.taskType) === '22';
            } else if (taskTypeFilter === 'dava-pending') {
                return isDava && t.status === 'awaiting_client_approval';
            } else if (taskTypeFilter === 'dava-completed') {
                return isDava && t.status !== 'awaiting_client_approval';
            }
            return true;
        });

        this.state.filteredTasks = filtered;

        // Render İşlemini RenderHelper'a Devret!
        this.renderHelper.renderTaskSection(filtered, 'task-list-container', taskTypeFilter);
    }

    // ==========================================
    // 4. OLAY DİNLEYİCİLERİ (EVENT LISTENERS)
    // ==========================================
    setupEventListeners() {
        document.getElementById('logoutBtn').addEventListener('click', () => {
            supabase.auth.signOut().then(() => window.location.href = 'index.html');
        });

        // Tab Değişimleri
        $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
            const target = $(e.target).attr("href");
            if (target === '#reports') this.renderReports();
        });

        // Portföy Filtreleri
        $('#menseFilter, #portfolioDurumFilter').on('change', () => this.filterPortfolios());
        $('#portfolioSearchText').on('keyup', () => this.filterPortfolios());

        // Fatura Filtreleri
        $('#invoiceDurumFilter').on('change', () => this.filterInvoices());
        $('#invoiceSearchText').on('keyup', () => this.filterInvoices());

        // Vekalet Filtresi
        $('#contractsSearchText').on('keyup', () => this.filterContracts());

        // İşlerim (Task) Navigasyonu
        $('.task-card-link').click((e) => {
            const el = e.currentTarget;
            $('.task-card-link').removeClass('active-task-area');
            el.classList.add('active-task-area');
            
            $('#task-detail-cards').slideUp();
            $('#dava-task-detail-cards').slideUp();
            $('#task-list-filters').slideUp();
            $('#task-list-container').html('');

            const area = el.dataset.targetArea;
            if(area === 'marka-tasks') $('#task-detail-cards').slideDown();
            else if(area === 'dava-tasks') $('#dava-task-detail-cards').slideDown();
        });

        $('.detail-card-link').click((e) => {
            const el = e.currentTarget;
            $('.detail-card-link').removeClass('active-list-type');
            el.classList.add('active-list-type');
            $('#task-list-filters').slideDown();
            this.filterTasks();
        });

        // Görev Aksiyonları (Onay/Ret)
        $(document).on('click', '.task-action-btn', async (e) => {
            const btn = e.currentTarget;
            const taskId = btn.dataset.id;
            const action = btn.dataset.action;

            if (action === 'approve' && confirm('Bu işi onaylamak istiyor musunuz?')) {
                try {
                    await supabase.from('tasks').update({ status: 'open' }).eq('id', taskId);
                    alert('İş onaylandı.');
                    await this.loadAllData(); // Ekranı yenile
                } catch(err) {}
            } else if (action === 'reject') {
                const reason = prompt('Lütfen ret sebebini yazınız:');
                if (reason) {
                    try {
                        await supabase.from('tasks').update({ status: 'müvekkil onayı - kapatıldı', rejection_reason: reason }).eq('id', taskId);
                        alert('İş reddedildi.');
                        await this.loadAllData();
                    } catch(err) {}
                }
            }
        });

        // Portföy Detay Modal Açma
        // Portföy Detay Modal Açma
        $(document).on('click', '.portfolio-detail-link', async (e) => {
            e.preventDefault();
            const itemId = e.currentTarget.dataset.itemId;
            const item = this.state.portfolios.find(p => p.id === itemId);
            if (!item) return;

            document.getElementById('portfolioDetailModalLabel').textContent = item.title;
            document.getElementById('modal-img').src = item.brandImageUrl || 'https://placehold.co/150x150?text=Yok';
            document.getElementById('modal-details-card').innerHTML = `<p><strong>Tür:</strong> ${item.type}</p><p><strong>Başvuru No:</strong> ${item.applicationNumber}</p><p><strong>Sınıflar:</strong> ${item.classes}</p>`;
            document.getElementById('modal-dates-card').innerHTML = `<p><strong>Başvuru:</strong> ${this.formatDate(item.applicationDate)}</p><p><strong>Yenileme:</strong> ${this.formatDate(item.renewalDate)}</p><span class="badge badge-primary">${item.status}</span>`;
            
            // Eşya Listesi Render
            let esyaHtml = '<p class="text-muted">Veri yok.</p>';
            if (item.classes && item.classes !== '-') {
                // Şimdilik sadece sınıfları gösteriyoruz, detaylı eşya listesi DB'den (ip_record_classes) çekilip eklenebilir
                esyaHtml = `<div><b>Kayıtlı Sınıflar</b>: ${item.classes}</div>`;
            }
            document.getElementById('esyaListesiContent').innerHTML = esyaHtml;
            
            // İşlemleri Çek ve YENİ AKILLI RENDER'I KULLAN!
            document.querySelector('#modal-islemler tbody').innerHTML = '<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Yükleniyor...</td></tr>';
            $('#portfolioDetailModal').modal('show');
            $('#myTab a[href="#modal-islemler"]').tab('show'); 
            
            try {
                // İşlemleri evraklarıyla beraber çek
                const { data: txs } = await supabase
                    .from('transactions')
                    .select('*, transaction_types(alias, name), transaction_documents(*)')
                    .eq('ip_record_id', item.id)
                    .order('created_at', { ascending: false });
                
                // RenderHelper'a gönder
                this.renderHelper.renderTransactionHistory(txs || [], 'modal-islemler');
            } catch (err) {
                console.error(err);
                document.querySelector('#modal-islemler tbody').innerHTML = '<tr><td colspan="4" class="text-center text-danger">İşlemler yüklenemedi.</td></tr>';
            }
        });

        // Mal/Hizmet Kıyaslama Modalını Açma
        $(document).on('click', '.task-compare-goods', async (e) => {
            const btn = e.currentTarget;
            const ipRecordId = btn.dataset.ipRecordId;
            const targetAppNo = btn.dataset.targetAppNo;

            document.getElementById('monitoredGoodsContent').innerHTML = '<p class="text-muted"><i class="fas fa-spinner fa-spin"></i> Yükleniyor...</p>';
            document.getElementById('competitorGoodsContent').innerHTML = '<p class="text-muted"><i class="fas fa-spinner fa-spin"></i> Yükleniyor...</p>';
            $('#goodsComparisonModal').modal('show');

            try {
                // Kendi markamızın sınıflarını çek
                const { data: myRecord } = await supabase.from('ip_record_classes').select('class_no, items').eq('ip_record_id', ipRecordId);
                let myHtml = '<p class="text-muted">Sınıf verisi bulunamadı.</p>';
                if (myRecord && myRecord.length > 0) {
                    myHtml = myRecord.map(c => `<div><h6 class="text-primary font-weight-bold">Sınıf ${c.class_no}</h6><p style="font-size:0.85rem">${Array.isArray(c.items) ? c.items.join('; ') : c.items}</p></div>`).join('<hr>');
                }
                document.getElementById('monitoredGoodsContent').innerHTML = myHtml;

                // Karşı tarafın eşyalarını bülten kayıtlarından çek
                const cleanAppNo = String(targetAppNo).replace(/[^a-zA-Z0-9]/g, '');
                const { data: compRecord } = await supabase.from('trademark_bulletin_records').select('goods').like('application_number', `%${cleanAppNo}%`).limit(1).maybeSingle();
                
                let compHtml = '<p class="text-muted">Bülten kaydı eşya listesi bulunamadı.</p>';
                if (compRecord && compRecord.goods) {
                    compHtml = (Array.isArray(compRecord.goods) ? compRecord.goods : [compRecord.goods]).map(g => `<p style="font-size:0.85rem; margin-bottom:10px;">${g}</p>`).join('');
                }
                document.getElementById('competitorGoodsContent').innerHTML = compHtml;

            } catch(err) {
                console.error(err);
                document.getElementById('monitoredGoodsContent').innerHTML = '<p class="text-danger">Veriler yüklenirken hata oluştu.</p>';
            }
        });
    }

    // ==========================================
    // 5. RAPORLAR VE GRAFİKLER
    // ==========================================
    renderReports() {
        const portfolios = this.state.portfolios;
        const legalData = [...this.state.suits, ...this.state.filteredObjections || []];
        const taskData = this.state.tasks;

        if (portfolios.length === 0 && legalData.length === 0) {
            document.getElementById('world-map-markers').innerHTML = '<div class="d-flex justify-content-center align-items-center h-100 text-muted">Bu müşteri için analiz edilecek veri bulunamadı.</div>';
            return;
        }

        let mapData = {};                 
        let uniqueCountries = new Set();  
        let typeCounts = {};              
        let classCounts = {};             
        let budgetForecast = {};          
        const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
        
        const now = new Date();
        const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(now.getMonth() - 6);
        const nextYear = new Date(); nextYear.setFullYear(now.getFullYear() + 1);

        portfolios.forEach(item => {
            // A) Harita Verisi
            let code = '';
            const originRaw = (item.origin || '').toUpperCase();
            if (originRaw.includes('TURK')) code = 'TR';
            else if (item.country) code = item.country.toUpperCase().trim();
            
            if (code && code.length === 2) {
                mapData[code] = (mapData[code] || 0) + 1;
                uniqueCountries.add(code);
            }

            // B) Varlık Türü
            const t = item.type === 'trademark' ? 'Marka' : (item.type === 'patent' ? 'Patent' : (item.type === 'design' ? 'Tasarım' : item.type));
            typeCounts[t] = (typeCounts[t] || 0) + 1;

            // C) Sınıflar
            if (item.classes && item.classes !== '-') {
                item.classes.split(',').forEach(c => {
                    const cleanC = c.trim();
                    if (cleanC) classCounts[cleanC] = (classCounts[cleanC] || 0) + 1;
                });
            }

            // D) Bütçe Projeksiyonu
            if (item.renewalDate) {
                let rDate = new Date(item.renewalDate);
                if (rDate > now && rDate < nextYear) {
                    const key = `${rDate.getFullYear()}-${rDate.getMonth()}`; 
                    const cost = originRaw.includes('TURK') ? 4500 : 15000; 
                    budgetForecast[key] = (budgetForecast[key] || 0) + cost;
                }
            }
        });

        // HARİTA ÇİZİMİ
        const mapContainer = document.getElementById("world-map-markers");
        mapContainer.innerHTML = ""; 
        if (Object.keys(mapData).length > 0 && window.jsVectorMap) {
            new jsVectorMap({
                selector: '#world-map-markers',
                map: 'world',
                zoomButtons: true,
                regionStyle: {
                    initial: { fill: '#e3eaef', stroke: 'none', "stroke-width": 0 },
                    hover: { fillOpacity: 0.7, cursor: 'pointer' }
                },
                visualizeData: { scale: ['#a2cffe', '#2e59d9'], values: mapData },
                onRegionTooltipShow(event, tooltip, code) {
                    const count = mapData[code] || 0;
                    if (count > 0) tooltip.text(`<strong>${tooltip.text()}</strong>: ${count} Dosya`, true);
                }
            });
        }

        // KPI'LAR
        document.getElementById('rep-total-assets').textContent = portfolios.length;
        document.getElementById('rep-total-countries').textContent = uniqueCountries.size + ' Ülke';
        document.getElementById('rep-pending-tasks').textContent = taskData.filter(t => t.status === 'awaiting_client_approval').length;
        
        const activeLegal = legalData.filter(l => !(l.statusText || l.suitStatus || '').toLowerCase().includes('kapatıldı')).length;
        document.getElementById('rep-active-legal').textContent = activeLegal;
        
        const totalBudget = Object.values(budgetForecast).reduce((a,b)=>a+b, 0);
        document.getElementById('rep-budget-est').textContent = '₺' + totalBudget.toLocaleString('tr-TR');

        // SÜRÜNCEMEDE KALAN İŞLER
        const stuckItems = portfolios.filter(item => {
            const status = (item.status || '').toLowerCase();
            const appDate = item.applicationDate ? new Date(item.applicationDate) : null;
            return (status.includes('başvuru') || status.includes('pending')) && appDate && appDate < sixMonthsAgo;
        }).sort((a,b) => new Date(a.applicationDate) - new Date(b.applicationDate)).slice(0, 5);

        const stuckTableBody = document.getElementById('rep-stuck-list');
        stuckTableBody.innerHTML = '';
        if (stuckItems.length === 0) {
            stuckTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-success py-3"><i class="fas fa-check-circle"></i> Harika! Sürüncemede kalan işiniz bulunmuyor.</td></tr>';
        } else {
            stuckItems.forEach(item => {
                const appDate = new Date(item.applicationDate);
                const diffDays = Math.ceil(Math.abs(now - appDate) / (1000 * 60 * 60 * 24)); 
                stuckTableBody.innerHTML += `
                    <tr>
                        <td><div class="font-weight-bold text-truncate" style="max-width: 150px;">${item.title}</div></td>
                        <td><span class="badge badge-light border">Başvuru Aşamasında</span></td>
                        <td class="text-danger font-weight-bold">${diffDays} Gündür</td>
                        <td><small class="text-muted">İlerleme Yok</small></td>
                    </tr>`;
            });
        }

        // GRAFİKLER (ApexCharts)
        const renderChart = (id, options) => {
            const el = document.querySelector("#" + id);
            if(!el) return;
            el.innerHTML = "";
            new ApexCharts(el, { fontFamily: 'inherit', theme: { mode: document.body.classList.contains('dark-mode') ? 'dark' : 'light' }, toolbar: { show: false }, ...options }).render();
        };

        renderChart('chart-portfolio-dist', {
            series: Object.values(typeCounts), labels: Object.keys(typeCounts),
            chart: { type: 'donut', height: 260 }, colors: ['#4e73df', '#1cc88a', '#36b9cc']
        });

        const topClasses = Object.entries(classCounts).sort((a,b)=>b[1]-a[1]).slice(0, 6);
        renderChart('chart-class-radar', {
            series: [{ name: 'Marka Sayısı', data: topClasses.map(x => x[1]) }],
            labels: topClasses.map(x => `Sınıf ${x[0]}`),
            chart: { type: 'radar', height: 260 }, colors: ['#36b9cc']
        });

        const sortedBudgetKeys = Object.keys(budgetForecast).sort();
        renderChart('chart-budget-forecast', {
            series: [{ name: 'Tahmini Tutar', data: sortedBudgetKeys.map(k => budgetForecast[k]) }],
            xaxis: { categories: sortedBudgetKeys.map(k => { const [y, m] = k.split('-'); return `${monthNames[parseInt(m)]} ${y}`; })},
            chart: { type: 'bar', height: 260 }, colors: ['#4e73df'],
            yaxis: { labels: { formatter: (val) => (val/1000).toFixed(1) + 'k' } }, dataLabels: { enabled: false }
        });
    }
    
    // ==========================================
    // YARDIMCI FONKSİYONLAR
    // ==========================================
    formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        } catch { return '-'; }
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.classList.add(savedTheme + '-mode');
        document.getElementById('themeSwitch').checked = (savedTheme === 'dark');
        
        document.getElementById('themeSwitch').addEventListener('change', (e) => {
            const isDark = e.target.checked;
            document.body.classList.remove('light-mode', 'dark-mode');
            document.body.classList.add(isDark ? 'dark-mode' : 'light-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // HTML İçinden Çağrılan Inline JS Fonksiyonlarını Window'a Bağla
    exposeGlobalFunctions() {
        window.switchClient = (clientId, fromModal = false) => {
            if (fromModal) $('#clientSelectionModal').modal('hide');
            this.state.selectedClientId = clientId;
            sessionStorage.setItem('selectedClientSession', clientId);
            this.updateClientNameDisplay();
            this.loadAllData(); // Verileri baştan çek
        };

        window.initReports = () => this.renderReports();
        
        window.exportActiveTable = (type) => {
            alert("Export özelliği Supabase yapısı için hazırlanıyor.");
        };
        
        window.triggerTpQuery = (appNo) => {
            const cleanAppNo = String(appNo).replace(/[^a-zA-Z0-9/]/g, '');
            window.open(`https://portal.turkpatent.gov.tr/anonim/arastirma/marka/sonuc?dosyaNo=${encodeURIComponent(cleanAppNo)}`, '_blank');
        };
    }
}

// Sistemi Başlat
document.addEventListener('DOMContentLoaded', () => {
    const portal = new ClientPortalController();
    portal.init();
});