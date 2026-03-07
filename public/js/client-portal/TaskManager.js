// public/js/client-portal/TaskManager.js
import { supabase } from '../../supabase-config.js';

export class TaskManager {
    // clientIpRecordIds = PortfolioManager'dan bulduğumuz markaların ID'leri
    async getTasks(clientIds, clientIpRecordIds = []) {
        if (!clientIds || clientIds.length === 0) return [];

        try {
            // Supabase sorgusu: Görev doğrudan müvekkile atanmış OR görevin bağlı olduğu marka müvekkilin
            let query = supabase
                .from('tasks')
                .select(`
                    *,
                    ip_records ( application_number, ip_record_trademark_details(brand_name, brand_image_url) ),
                    transaction_types ( name, alias )
                `);

            let orConditions = [`task_owner_id.in.(${clientIds.join(',')})`];
            if (clientIpRecordIds.length > 0) {
                // Çok fazla ID varsa Supabase'i patlatmamak için parçalayabiliriz, ancak genelde bir firmanın binlerce markası aynı anda işlemde olmaz
                orConditions.push(`ip_record_id.in.(${clientIpRecordIds.join(',')})`);
            }
            
            query = query.or(orConditions.join(',')).order('created_at', { ascending: false });

            const { data, error } = await query;

            if (error) throw error;

            return data.map(task => {
                const ipRecord = task.ip_records || {};
                const tmDetails = ipRecord.ip_record_trademark_details?.[0] || {};
                const typeObj = task.transaction_types || {};

                return {
                    id: String(task.id),
                    title: task.title || '-',
                    taskType: String(task.task_type_id),
                    taskTypeDisplay: typeObj.alias || typeObj.name || 'İşlem',
                    status: task.status,
                    dueDate: task.operational_due_date || task.official_due_date,
                    officialDueDate: task.official_due_date,
                    createdAt: task.created_at,
                    relatedIpRecordId: task.ip_record_id,
                    appNo: ipRecord.application_number || '-',
                    recordTitle: tmDetails.brand_name || '-',
                    brandImageUrl: tmDetails.brand_image_url || '',
                    clientId: task.task_owner_id,
                    details: typeof task.details === 'string' ? JSON.parse(task.details) : (task.details || {}),
                    // UI tarafı "_relatedClientIds" olarak bekliyor
                    _relatedClientIds: [task.task_owner_id, ...clientIds].filter(Boolean)
                };
            });
        } catch (error) {
            console.error("Görevler çekilirken hata:", error);
            return [];
        }
    }
}