// gestao.js
import { saveData } from './storage.js';

// =========================================================================
// DICIONÁRIO DE DADOS ESTÁTICO: LOCALIDADES E TODOS OS SEUS CÓDIGOS POSTAIS
// =========================================================================
export const AREAS_POSTAL_CODES = {
    "AZUEIRA": ["2665-004", "2665-020", "2665-012", "2665-022", "2665-017", "2665-003", "2665-011", "2665-008", "2665-010", "2665-013", "2665-018", "2665-002", "2665-997", "2665-015", "2665-009", "2665-006", "2665-007", "2665-001", "2665-005", "2665-014"],
    "CARVOEIRA MFR": ["2655-125", "2655-129", "2655-072", "2655-073", "2655-132", "2655-035", "2655-128", "2655-131", "2655-012", "2655-074", "2655-127", "2655-042", "2655-020", "2655-015", "2655-075", "2655-010", "2655-138", "2655-030", "2655-117", "2655-041", "2655-049", "2655-037", "2655-036", "2655-040", "2655-033", "2655-051", "2655-054", "2655-056", "2655-038", "2657-303", "2655-034", "2655-039", "2655-043", "2655-044", "2655-045", "2655-046", "2655-047", "2655-048", "2655-050", "2655-053", "2655-055", "2655-070", "2655-009", "2655-071", "2655-089", "2655-108", "2655-085", "2655-082", "2655-096", "2655-097", "2655-104", "2655-105", "2655-106", "2655-103", "2655-099", "2655-101", "2655-080", "2655-081", "2655-083", "2655-084", "2655-087", "2655-088", "2655-090", "2655-091", "2655-093", "2655-094", "2655-095", "2655-098", "2655-100", "2655-102", "2655-107", "2655-109", "2655-111", "2655-113", "2655-130", "2655-077", "2655-119", "2655-120", "2655-121", "2655-011", "2655-052", "2655-135", "2655-116", "2655-079", "2655-078", "2655-122", "2655-124", "2655-123", "2655-150", "2655-133", "2655-137", "2655-013", "2655-076"],
    "CHELEIROS": ["2640-180", "2640-119", "2640-111", "2640-120", "2640-121", "2640-122", "2640-123", "2640-124", "2640-125", "2640-126", "2640-127", "2640-128", "2640-129", "2640-130", "2640-131", "2640-132", "2640-133", "2640-134", "2640-135", "2640-136", "2640-137", "2640-138", "2640-139", "2640-140", "2640-141", "2640-142", "2640-143", "2640-144", "2640-145", "2640-146", "2640-149", "2640-150", "2640-151", "2640-152", "2640-153", "2640-154", "2640-155", "2640-156", "2640-157", "2640-158", "2640-159", "2640-160", "2640-161", "2640-162", "2640-163", "2640-164", "2640-165", "2640-166", "2640-167", "2640-168", "2640-169", "2640-170", "2640-171", "2640-172", "2640-173", "2640-174", "2640-112", "2640-113", "2640-115", "2640-114", "2640-191"],
    "ENCARNAÇÃO": ["2640-217", "2640-215", "2640-232", "2640-208", "2640-204", "2640-211", "2640-205", "2640-213", "2640-253", "2640-230", "2644-032", "2640-229", "2640-210", "2640-250", "2640-256", "2640-223", "2640-228", "2640-219", "2640-222", "2640-226", "2640-231", "2640-214", "2640-266", "2640-224", "2644-033", "2644-602", "2640-259", "2640-202", "2640-260", "2640-261", "2640-218", "2640-265", "2640-206", "2640-254", "2640-255", "2640-212", "2640-264", "2640-257", "2640-258", "2640-216", "2640-201", "2640-262", "2640-203", "2640-251", "2640-252"],
    "ENXARA DO BISPO": ["2665-061", "2665-051", "2665-052", "2665-053", "2665-054", "2665-055", "2665-057", "2665-059", "2665-060", "2665-062", "2665-063", "2665-049", "2665-050"],
    "ERICEIRA": ["2655-319", "2655-490", "2655-445", "2655-498", "2655-410", "2655-447", "2655-504", "2655-502", "2655-501", "2655-503", "2655-500", "2655-438", "2657-302", "2655-210", "2655-218", "2655-221", "2655-222", "2655-223", "2655-225", "2655-226", "2655-227", "2655-228", "2655-229", "2655-263", "2655-231", "2655-232", "2655-233", "2655-234", "2655-235", "2655-236", "2655-237", "2655-238", "2655-239", "2655-240", "2655-241", "2655-242", "2655-243", "2655-244", "2655-245", "2655-246", "2655-247", "2655-248", "2655-249", "2655-250", "2655-251", "2655-252", "2655-253", "2655-254", "2655-255", "2655-256", "2655-257", "2655-258", "2655-259", "2655-262", "2655-264", "2655-265", "2655-368", "2655-369", "2655-370", "2655-266", "2655-267", "2655-268", "2655-269", "2655-271", "2655-272", "2655-273", "2655-274", "2655-275", "2655-276", "2655-277", "2655-278", "2655-279", "2655-280", "2655-281", "2655-282", "2655-283", "2655-284", "2655-285", "2655-286", "2655-287", "2655-288", "2655-289", "2655-290", "2655-291", "2655-292", "2655-293", "2655-294", "2655-295", "2655-296", "2655-297", "2655-298", "2655-299", "2655-300", "2655-301", "2655-366", "2655-302", "2655-303", "2655-304", "2655-305", "2655-306", "2655-307", "2655-308", "2655-309", "2655-310", "2655-311", "2655-312", "2655-313", "2655-314", "2655-315", "2655-316", "2655-317", "2655-318", "2659-501", "2655-320", "2655-321", "2655-322", "2655-323", "2655-324", "2655-325", "2655-326", "2655-327", "2655-328", "2655-329", "2655-330", "2655-331", "2655-457", "2655-332", "2655-333", "2655-334", "2655-335", "2655-336", "2655-337", "2655-338", "2655-339", "2655-340", "2655-341", "2655-342", "2655-343", "2655-344", "2655-999", "2655-345", "2659-601", "2655-346", "2655-347", "2655-348", "2655-349", "2657-301", "2655-350", "2655-351", "2655-352", "2655-353", "2655-354", "2655-355", "2655-356", "2655-357", "2655-358", "2655-359", "2655-360", "2655-361", "2655-362", "2655-363", "2655-364", "2655-365", "2655-431", "2655-400", "2655-415", "2655-434", "2655-440", "2655-436", "2655-435", "2655-437", "2655-444", "2655-478", "2655-139", "2655-209", "2655-220", "2655-373", "2655-468", "2655-376", "2655-377", "2655-378", "2655-493", "2655-285", "2655-214", "2655-472", "2655-481", "2655-482", "2655-505", "2655-006", "2655-483", "2655-496", "2655-230", "2655-379", "2655-454", "2655-484", "2655-485", "2655-486", "2655-487", "2655-488", "2655-489", "2655-491", "2655-353", "2655-420", "2655-202", "2655-425", "2655-449", "2655-205", "2655-206", "2655-374", "2655-430", "2655-450", "2655-458", "2655-208", "2655-475", "2655-405", "2655-476", "2655-474", "2655-451", "2655-477", "2655-469", "2655-464", "2655-480", "2655-459", "2655-492", "2655-460", "2655-494"],
    "GRADIL": ["2665-100", "2665-137", "2665-135", "2665-101", "2665-142", "2665-155", "2665-131", "2665-134", "2665-125", "2665-107", "2665-156", "2665-114", "2665-157", "2665-153", "2665-128", "2665-152", "2665-102", "2665-103", "2665-104", "2665-105", "2665-106", "2665-108", "2665-136", "2665-115", "2665-113", "2665-139", "2665-109", "2665-140", "2665-141", "2665-110", "2665-111", "2665-112", "2665-130", "2665-132", "2665-116", "2665-117", "2667-306", "2665-118", "2665-119", "2665-120", "2665-122", "2665-123", "2665-124", "2665-126", "2665-127", "2665-129", "2665-133", "2669-001", "2665-150", "2665-151", "2665-138"],
    "IGREJA NOVA MFR": ["2640-307", "2640-309", "2640-310", "2640-311", "2640-364", "2640-321", "2640-344", "2640-367", "2640-340", "2640-320", "2640-322", "2640-323", "2640-324", "2640-325", "2640-326", "2640-327", "2640-328", "2640-329", "2640-330", "2640-331", "2640-332", "2640-333", "2640-334", "2640-335", "2640-336", "2640-337", "2640-338", "2640-341", "2640-342", "2640-343", "2640-361", "2640-369", "2640-365", "2640-316", "2640-319", "2640-376", "2640-317", "2640-372", "2640-363", "2640-366", "2640-368", "2640-371", "2640-378", "2640-379", "2640-312", "2640-313", "2640-302", "2640-303", "2640-373", "2640-306", "2640-370", "2640-301", "2640-377", "2640-300", "2640-362", "2640-308", "2640-360"],
    "MAFRA": ["2640-578", "2640-487", "2640-779", "2640-526", "2640-501", "2640-523", "2640-808", "2640-824", "2640-448", "2640-425", "2640-432", "2640-433", "2640-450", "2640-582", "2640-543", "2640-452", "2640-454", "2640-455", "2644-004", "2644-003", "2640-456", "2640-999", "2644-014", "2640-457", "2640-458", "2640-459", "2640-460", "2640-462", "2640-463", "2640-464", "2640-465", "2640-466", "2640-467", "2640-468", "2640-469", "2640-470", "2640-471", "2640-472", "2640-473", "2640-474", "2640-475", "2640-476", "2640-477", "2640-478", "2640-479", "2640-480", "2640-481", "2640-482", "2640-483", "2640-484", "2640-485", "2644-006", "2640-486", "2643-301", "2643-304", "2640-488", "2640-542", "2640-489", "2640-490", "2640-491", "2644-010", "2640-492", "2644-601", "2640-493", "2640-494", "2640-495", "2640-496", "2640-497", "2640-499", "2640-500", "2640-501", "2640-502", "2640-503", "2640-504", "2640-505", "2640-506", "2640-507", "2640-508", "2640-509", "2640-511", "2640-512", "2640-513", "2640-514", "2640-515", "2640-516", "2640-517", "2640-518", "2640-519", "2640-520", "2640-521", "2640-524", "2640-525", "2640-527", "2640-528", "2640-529", "2640-530", "2640-531", "2640-532", "2640-533", "2640-534", "2640-535", "2640-536", "2640-537", "2640-538", "2640-539", "2640-576", "2640-569", "2640-409", "2640-434", "2640-435", "2640-444", "2640-445", "2640-451", "2644-001", "2640-403", "2640-404", "2640-400", "2644-013", "2640-389", "2640-391", "2640-392", "2640-393", "2640-394", "2640-395", "2640-396", "2640-399", "2640-437", "2640-774", "2640-778", "2640-780", "2640-782", "2640-783", "2640-789", "2640-790", "2640-791", "2640-792", "2640-793", "2640-794", "2640-797", "2640-800", "2640-806", "2640-809", "2640-812", "2640-813", "2640-820", "2640-821", "2640-822", "2640-405", "2640-406", "2640-407", "2640-408", "2640-422", "2640-436", "2640-446", "2640-447", "2640-426", "2640-402", "2640-570", "2640-571", "2640-428", "2640-449", "2640-510", "2640-415", "2640-416", "2640-418", "2640-567", "2640-573", "2640-431", "2640-410", "2640-577", "2643-305", "2640-438", "2640-583", "2640-546", "2640-566", "2644-012", "2640-564", "2640-563", "2640-562", "2640-411", "2640-430", "2640-565", "2640-390", "2640-561", "2640-580", "2640-586", "2640-585", "2640-412", "2640-817", "2640-818", "2644-603", "2640-420", "2640-417", "2640-427", "2640-413", "2640-581", "2640-401", "2640-544", "2640-419", "2640-387"],
    "MALVEIRA": ["2665-191", "2665-222", "2665-245", "2665-257", "2665-286", "2665-210", "2665-218", "2665-199", "2665-653", "2665-272", "2665-273", "2665-275", "2665-192", "2665-278", "2665-283", "2665-258", "2665-226", "2669-601", "2665-208", "2665-209", "2665-281", "2665-188", "2665-189", "2665-194", "2665-293", "2665-250", "2665-284", "2665-224", "2665-285", "2665-290", "2665-234", "2665-262", "2665-215", "2665-231", "2665-195", "2665-198", "2665-203", "2665-200", "2665-201", "2665-202", "2665-205", "2665-204", "2665-206", "2665-207", "2665-999", "2665-211", "2665-182", "2665-212", "2665-213", "2665-214", "2665-216", "2665-217", "2665-219", "2665-220", "2665-221", "2665-223", "2665-621", "2665-622", "2665-225", "2665-227", "2665-228", "2665-229", "2665-230", "2665-264", "2665-232", "2665-233", "2665-239", "2665-235", "2665-236", "2665-237", "2665-238", "2665-240", "2665-241", "2665-242", "2665-243", "2665-244", "2665-246", "2665-247", "2665-248", "2665-249", "2665-251", "2665-252", "2665-253", "2665-254", "2665-255", "2665-256", "2665-259", "2665-260", "2665-261", "2665-262", "2665-263", "2665-266", "2665-267", "2665-268", "2665-269", "2665-270", "2665-271", "2665-291", "2665-187", "2665-296", "2665-190", "2665-298", "2665-297", "2665-183", "2665-197", "2665-288", "2665-299", "2665-295", "2665-292", "2665-557", "2665-185", "2665-186", "2665-294"],
    "MILHARADO": ["2665-301", "2665-303", "2665-304", "2665-305", "2665-306", "2665-308", "2665-310", "2665-311", "2665-312", "2665-309", "2665-388", "2665-314", "2665-307", "2667-303", "2665-315", "2665-316", "2665-370", "2665-372", "2665-373", "2665-374", "2665-375", "2665-377", "2665-371", "2665-378", "2665-379", "2665-382", "2665-381", "2665-383", "2665-302", "2665-387", "2665-364", "2665-320", "2665-358", "2665-322", "2665-357", "2665-337", "2665-360", "2665-369", "2665-331", "2665-319", "2665-300", "2665-366", "2665-354", "2665-329", "2665-334", "2665-330", "2665-313", "2665-321", "2665-323", "2665-324", "2665-325", "2665-326", "2665-327", "2665-328", "2665-332", "2665-335", "2665-336", "2665-338", "2665-340", "2665-341", "2665-343", "2665-345", "2665-346", "2665-347", "2665-350", "2665-351", "2665-352", "2665-353", "2665-355", "2665-356", "2665-996", "2665-359", "2665-361", "2665-363", "2665-376"],
    "SANTO ESTEVÃO DAS GALÉS": ["2665-401", "2665-402", "2665-403", "2665-404", "2665-405", "2665-406", "2665-407", "2665-408", "2665-409", "2665-410", "2665-411", "2665-412", "2665-413", "2665-400", "2665-414", "2665-415"],
    "SANTO ISIDORO MFR": ["2640-054", "2640-055", "2640-056", "2640-059", "2640-060", "2640-061", "2640-069", "2640-064", "2640-065", "2640-066", "2640-057", "2640-067", "2640-825", "2640-068", "2640-070", "2640-071", "2640-072", "2640-073", "2640-046", "2640-024", "2640-015", "2640-043", "2640-019", "2640-078", "2640-001", "2640-002", "2640-003", "2640-004", "2640-005", "2640-006", "2640-007", "2640-008", "2640-010", "2640-011", "2640-012", "2640-013", "2640-014", "2640-016", "2640-017", "2640-018", "2640-020", "2640-021", "2640-022", "2640-023", "2640-025", "2640-026", "2640-028", "2640-029", "2640-030", "2640-031", "2640-032", "2640-033", "2640-034", "2640-035", "2640-036", "2640-038", "2640-075", "2640-076", "2640-074", "2640-009", "2640-045", "2640-027", "2640-049", "2640-052", "2640-048", "2640-100", "2640-058", "2640-090", "2640-051", "2640-081", "2640-082", "2640-083", "2640-084", "2640-085", "2640-086", "2640-087", "2640-088", "2640-089", "2640-091", "2640-092", "2640-093", "2640-094", "2640-095", "2640-039", "2640-040", "2640-041", "2640-099", "2640-097", "2640-079", "2640-053"],
    "SOBRAL DA ABELHEIRA": ["2640-601", "2640-602", "2640-603", "2640-604", "2640-605", "2640-614", "2640-638", "2640-613", "2640-615", "2640-616", "2640-617", "2640-618", "2640-619", "2640-621", "2640-622", "2640-623", "2640-624", "2640-625", "2640-626", "2640-627", "2640-628", "2640-629", "2640-630", "2640-631", "2640-633", "2640-635", "2640-636", "2640-637", "2640-639", "2640-640", "2640-641", "2640-642", "2640-643", "2640-644", "2640-645", "2640-606", "2640-647", "2640-646"],
    "SÃO MIGUEL DE ALCAINÇA": ["2640-734", "2640-736", "2640-708", "2640-744", "2640-722", "2640-727", "2640-752", "2640-751", "2640-747", "2640-749", "2640-750", "2640-739", "2640-743", "2640-741", "2640-728", "2640-701", "2640-702", "2640-703", "2640-704", "2640-705", "2640-706", "2640-707", "2640-709", "2640-710", "2640-711", "2640-712", "2640-713", "2640-714", "2640-715", "2640-716", "2640-717", "2640-718", "2640-719", "2640-720", "2640-721", "2640-723", "2640-725", "2640-726", "2640-730", "2640-731", "2640-732", "2640-733", "2640-735", "2640-737", "2640-738", "2640-742", "2640-745", "2640-746", "2640-724", "2640-772", "2644-002", "2640-700"],
    "VENDA DO PINHEIRO": ["2665-505", "2665-506", "2665-601", "2665-494", "2665-535", "2665-550", "2665-562", "2665-512", "2665-595", "2665-584", "2665-620", "2665-515", "2665-556", "2665-545", "2665-605", "2665-608", "2665-565", "2665-533", "2665-611", "2665-618", "2665-619", "2665-547", "2665-592", "2665-602", "2665-609", "2665-589", "2665-577", "2665-497", "2665-628", "2665-615", "2665-534", "2665-560", "2665-617", "2665-598", "2665-502", "2665-616", "2665-540", "2665-582", "2665-518", "2665-519", "2665-521", "2665-520", "2665-522", "2667-304", "2665-998", "2667-307", "2665-523", "2665-524", "2665-525", "2665-526", "2665-527", "2665-528", "2665-529", "2665-530", "2665-531", "2665-532", "2665-534", "2665-536", "2665-538", "2665-539", "2665-543", "2665-548", "2665-549", "2665-551", "2665-552", "2665-554", "2665-555", "2665-558", "2665-559", "2665-561", "2665-563", "2665-566", "2665-567", "2665-568", "2665-569", "2665-570", "2665-573", "2665-574", "2665-575", "2665-576", "2665-578", "2665-579", "2665-580", "2665-581", "2665-583", "2665-586", "2665-588", "2665-590", "2665-624", "2665-587", "2665-503", "2665-623", "2665-600", "2665-627", "2665-500", "2665-597", "2665-537", "2665-541", "2665-553", "2665-564", "2667-301", "2665-495", "2667-305", "2665-501"],
    "VILA FRANCA DO ROSÁRIO": ["2665-429", "2665-417", "2665-418", "2665-419", "2665-420", "2665-421", "2665-426", "2665-422", "2665-423", "2665-424", "2665-425", "2665-607"]
};

/**
 * Renderiza a lista de motoristas cadastrados com a indicação dos seus Setores.
 * ATUALIZADO: um motorista pode agora ter VÁRIOS setores (driver.sectorIds é um array).
 */
export function renderDrivers(drivers, sectors, listaMotoristas, deleteDriver, editDriver) {
    if (!listaMotoristas) return;
    listaMotoristas.innerHTML = drivers.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum motorista registado.</p>' : '';
    
    drivers.forEach(driver => {
        const driverSectorIds = Array.isArray(driver.sectorIds) ? driver.sectorIds : [];
        const sectorNames = driverSectorIds
            .map(sid => sectors.find(s => s.id === sid))
            .filter(Boolean)
            .map(s => s.name);

        const sectorBadgesHtml = sectorNames.length > 0
            ? sectorNames.map(name => `<span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 text-[9px] font-bold">${name}</span>`).join('')
            : '<span class="italic text-gray-400">Sem Setor associado</span>';

        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in";
        div.innerHTML = `
            <div class="flex-1 truncate pr-2">
                <div class="flex items-center space-x-3">
                    <span class="w-4 h-4 rounded-full border shadow-sm" style="background-color: ${driver.color}"></span>
                    <span class="font-semibold text-gray-700">${driver.name}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1.5 flex items-center flex-wrap gap-1">
                    <i class="fa-solid fa-map-location-dot mr-0.5"></i> ${sectorBadgesHtml}
                </div>
            </div>
            <div class="flex items-center space-x-1 flex-shrink-0">
                <button class="btn-edit-motorista text-blue-500 hover:text-blue-700 font-bold p-1.5"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-del-motorista text-red-500 hover:text-red-700 font-bold p-1.5"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        div.querySelector('.btn-edit-motorista').onclick = () => editDriver(driver);
        div.querySelector('.btn-del-motorista').onclick = () => deleteDriver(driver.id);
        listaMotoristas.appendChild(div);
    });
}

/**
 * Processa a submissão do formulário de motorista.
 * ATUALIZADO: lê os setores marcados nas checkboxes (um motorista pode ter VÁRIOS
 * setores). Verifica window.driverSendoEditado — se existir, ATUALIZA o motorista
 * existente em vez de criar sempre um novo registo duplicado.
 */
export function handleDriverSubmit(e, drivers, selectedColor, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('nome-motorista');
    const checkboxesContainer = document.getElementById('checkboxes-setores-motorista');
    const btnSubmit = document.getElementById('btn-submit-motorista');
    const btnCancelar = document.getElementById('btn-cancelar-motorista');
    
    const nome = nomeInput.value.trim();
    if (!nome) return;

    const checkedBoxes = checkboxesContainer ? checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked') : [];
    const sectorIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (sectorIds.length === 0) {
        alert('Por favor, selecione pelo menos um Setor para o motorista.');
        return;
    }

    const emEdicao = window.driverSendoEditado;

    // Validação de segurança redundante: garante que nenhum setor selecionado já
    // pertence a OUTRO motorista (ignora o próprio, se estivermos em modo de edição)
    const setorDuplicado = sectorIds.find(sid =>
        drivers.some(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(sid) && (!emEdicao || d.id !== emEdicao.id))
    );

    if (setorDuplicado) {
        alert('Erro de Segurança: um dos setores selecionados já está atribuído a outro motorista.');
        return;
    }

    if (emEdicao) {
        // Atualiza o motorista existente (mesmo id), em vez de criar um novo
        const driverIndex = drivers.findIndex(d => d.id === emEdicao.id);
        if (driverIndex !== -1) {
            drivers[driverIndex].name = nome;
            drivers[driverIndex].color = selectedColor;
            drivers[driverIndex].sectorIds = sectorIds;
        }
        window.driverSendoEditado = null;
    } else {
        drivers.push({ 
            id: 'd_' + Date.now(), 
            name: nome, 
            color: selectedColor,
            sectorIds: sectorIds 
        });
    }

    saveData(
        drivers, 
        [], // cp_intervals obsoletos
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false,
        JSON.parse(localStorage.getItem('cp_zones')) || []
    );
    
    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Adicionar Motorista";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
    alert(emEdicao ? 'Motorista atualizado com sucesso!' : 'Motorista registado com sucesso!');
}

/**
 * Renderiza checkboxes de Setores para associar a um motorista.
 * REGRA: um motorista pode ter VÁRIOS setores, mas cada setor só pode pertencer
 * a UM motorista de cada vez (exclusividade do lado do setor).
 */
export function renderSectorCheckboxes(sectors, container, drivers = [], editingDriverId = null) {
    if (!container) return;
    container.innerHTML = "";

    if (sectors.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-2">Nenhum setor registado. Crie um setor primeiro.</p>';
        return;
    }

    sectors.forEach(sector => {
        // Verifica se este setor já pertence a OUTRO motorista
        const driverOwner = drivers.find(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(sector.id) && d.id !== editingDriverId);
        // Verifica se este setor já pertence ao motorista atualmente em edição (vem pré-marcado)
        const belongsToEditingDriver = !!(editingDriverId && drivers.some(d => d.id === editingDriverId && Array.isArray(d.sectorIds) && d.sectorIds.includes(sector.id)));

        const label = document.createElement('label');

        if (driverOwner) {
            // Setor indisponível (já pertence a outro motorista)
            label.className = "flex items-center justify-between p-2 rounded bg-gray-100/50 text-gray-400 cursor-not-allowed select-none";
            label.innerHTML = `
                <div class="flex items-center space-x-2">
                    <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-4 h-4 cursor-not-allowed">
                    <span class="font-bold text-gray-400 line-through">${sector.name}</span>
                </div>
                <span class="text-[9px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded border">
                    Com: ${driverOwner.name}
                </span>
            `;
        } else {
            // Setor livre (ou já pertence ao próprio motorista em edição)
            label.className = "flex items-center justify-between p-2 rounded hover:bg-gray-100 cursor-pointer text-xs";
            label.innerHTML = `
                <div class="flex items-center space-x-2 text-gray-700">
                    <input type="checkbox" value="${sector.id}" ${belongsToEditingDriver ? 'checked' : ''} class="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                    <span class="font-bold">${sector.name}</span>
                </div>
                <span class="text-[9px] bg-green-50 text-green-700 font-bold px-1.5 py-0.5 rounded border border-green-200">
                    Livre
                </span>
            `;
        }
        container.appendChild(label);
    });
}

/**
 * Processa a submissão de um Setor de Entrega com regras de exclusividade estritas.
 * CORRIGIDO: agora verifica window.sectorSendoEditado. Se existir, ATUALIZA o setor
 * existente em vez de criar sempre um novo registo duplicado, e a validação de área
 * duplicada ignora corretamente o próprio setor em edição.
 */
export function handleSectorSubmit(e, sectors, renderCallback) {
    e.preventDefault();
    const nomeInput = document.getElementById('setor-nome');
    const checkboxesContainer = document.getElementById('checkboxes-areas');
    const btnSubmit = document.getElementById('btn-submit-setor');
    const btnCancelar = document.getElementById('btn-cancelar-setor');
    
    const name = nomeInput.value.trim();
    if (!name) return;

    const checkedBoxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
    const selectedAreas = Array.from(checkedBoxes).map(cb => cb.value);

    if (selectedAreas.length === 0) {
        alert('Por favor, selecione pelo menos uma Localidade para compor o Setor.');
        return;
    }

    const emEdicao = window.sectorSendoEditado;

    // Validação de segurança redundante: garante que nenhuma área já está noutro setor
    // (ignora o próprio setor, se estivermos em modo de edição)
    const areaDuplicada = selectedAreas.find(area => 
        sectors.some(s => s.areaNames && s.areaNames.includes(area) && (!emEdicao || s.id !== emEdicao.id))
    );

    if (areaDuplicada) {
        alert(`Erro de Segurança: A área "${areaDuplicada}" já está atribuída a outro setor ativo.`);
        return;
    }

    if (emEdicao) {
        // Atualiza o setor existente (mesmo id), em vez de criar um novo
        const sectorIndex = sectors.findIndex(s => s.id === emEdicao.id);
        if (sectorIndex !== -1) {
            sectors[sectorIndex].name = name;
            sectors[sectorIndex].areaNames = selectedAreas;
        }
        window.sectorSendoEditado = null;
    } else {
        sectors.push({
            id: 's_' + Date.now(),
            name: name,
            areaNames: selectedAreas
        });
    }

    saveData(
        JSON.parse(localStorage.getItem('cp_drivers')) || [],
        [], // cp_intervals obsoletos
        JSON.parse(localStorage.getItem('cp_assignments')) || [],
        JSON.parse(localStorage.getItem('cp_partida')) || null,
        JSON.parse(localStorage.getItem('cp_entregas')) || [],
        JSON.parse(localStorage.getItem('cp_rota_otimizada')) || [],
        JSON.parse(localStorage.getItem('cp_data_rota')) || "",
        JSON.parse(localStorage.getItem('cp_rota_iniciada')) || false,
        sectors
    );

    nomeInput.value = "";
    if (btnSubmit) btnSubmit.textContent = "Criar Setor";
    if (btnCancelar) btnCancelar.classList.add('hidden');

    renderCallback();
    alert(emEdicao ? 'Setor atualizado com sucesso!' : 'Setor criado com sucesso!');
}

// Manter alias para evitar quebras de importação de arquivos legados
export const handleZoneSubmit = handleSectorSubmit;

/**
 * Renderiza a lista de Setores criados e as suas áreas geográficas associadas.
 * CORRIGIDO: agora recebe e usa o parâmetro "editSector" para desenhar o botão de editar
 */
export function renderSectors(sectors, listaSetores, deleteSector, editSector) {
    if (!listaSetores) return;
    listaSetores.innerHTML = sectors.length === 0 ? '<p class="text-sm text-gray-400 italic text-center py-4">Nenhum sector registado.</p>' : '';

    sectors.forEach(sector => {
        const subAreasHtml = sector.areaNames
            .map(areaName => `<div class="bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded border border-blue-100 text-[10px] font-bold">${areaName}</div>`)
            .join("");

        const div = document.createElement('div');
        div.className = "p-3 bg-gray-50 border rounded-lg text-xs animate-fade-in space-y-2";
        div.innerHTML = `
            <div class="flex items-center justify-between font-bold text-gray-800 border-b pb-1.5">
                <span class="text-sm"><i class="fa-solid fa-map-location-dot text-blue-500 mr-1"></i> ${sector.name}</span>
                <div class="flex items-center space-x-2">
                    <button class="btn-edit-setor text-blue-500 hover:text-blue-700 p-1"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button class="btn-del-setor text-red-500 hover:text-red-700 p-1"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>
            </div>
            <div class="flex flex-wrap gap-1">
                ${subAreasHtml || '<div class="italic text-gray-400">Nenhuma área associada.</div>'}
            </div>
        `;
        div.querySelector('.btn-edit-setor').onclick = () => editSector(sector);
        div.querySelector('.btn-del-setor').onclick = () => deleteSector(sector.id);
        listaSetores.appendChild(div);
    });
}

// Manter alias para evitar quebras de importação de arquivos legados
export const renderZones = renderSectors;

/**
 * Renderiza caixas de seleção com controle estrito de exclusividade de setor.
 * CORRIGIDO: agora recebe "editingId" para ignorar o próprio setor na verificação
 * de área já ocupada, e pré-marca (checked) as áreas que já pertencem a esse setor.
 */
export function renderAreaCheckboxes(sectors, container, editingId = null) {
    if (!container) return;
    container.innerHTML = "";

    const areasList = Object.keys(AREAS_POSTAL_CODES).sort();

    areasList.forEach(areaName => {
        // Verifica se a localidade já está associada a algum OUTRO setor (ignora o próprio, se em edição)
        const parentSector = sectors.find(s => s.areaNames && s.areaNames.includes(areaName) && s.id !== editingId);
        // Verifica se esta área já pertence ao setor que está a ser editado, para vir pré-selecionada
        const belongsToEditingSector = !!(editingId && sectors.some(s => s.id === editingId && s.areaNames && s.areaNames.includes(areaName)));

        const label = document.createElement('label');
        
        if (parentSector) {
            // Área indisponível (já está noutro setor)
            label.className = "flex items-center justify-between p-2 rounded bg-gray-100/50 text-gray-400 cursor-not-allowed select-none";
            label.innerHTML = `
                <div class="flex items-center space-x-2">
                    <input type="checkbox" disabled class="rounded text-gray-300 border-gray-200 w-4 h-4 cursor-not-allowed">
                    <span class="font-bold text-gray-400 line-through">${areaName}</span>
                </div>
                <span class="text-[9px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded border">
                    No setor: ${parentSector.name}
                </span>
            `;
        } else {
            // Área livre (disponível para seleção) — ou pertence ao próprio setor em edição
            label.className = "flex items-center justify-between p-2 rounded hover:bg-gray-100 cursor-pointer text-xs";
            label.innerHTML = `
                <div class="flex items-center space-x-2 text-gray-700">
                    <input type="checkbox" value="${areaName}" ${belongsToEditingSector ? 'checked' : ''} class="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4 cursor-pointer">
                    <span class="font-bold">${areaName}</span>
                </div>
                <span class="text-[9px] bg-green-50 text-green-700 font-bold px-1.5 py-0.5 rounded border border-green-200">
                    Livre
                </span>
            `;
        }
        container.appendChild(label);
    });
}

// Manter alias para compatibilidade com arquivos legados
export const renderIntervalCheckboxes = renderAreaCheckboxes;

/**
 * Função de resolução de triagem estrita: Determina o motorista a partir de um código postal
 */
export function findDriverForZip(zip, sectors, drivers) {
    if (!zip) return null;
    const normalizedZip = zip.trim(); // Ex: "2665-004"

    // 1. Encontrar a Localidade associada a este Código Postal
    let matchedAreaName = null;
    for (const [areaName, cpList] of Object.entries(AREAS_POSTAL_CODES)) {
        if (cpList.includes(normalizedZip)) {
            matchedAreaName = areaName;
            break;
        }
    }

    if (!matchedAreaName) return null;

    // 2. Encontrar o Setor que contém esta Localidade
    const matchedSector = sectors.find(s => s.areaNames && s.areaNames.includes(matchedAreaName));
    if (!matchedSector) return null;

    // 3. Encontrar o motorista atribuído a este Setor (agora entre a lista de setores dele)
    const matchedDriver = drivers.find(d => Array.isArray(d.sectorIds) && d.sectorIds.includes(matchedSector.id));
    return matchedDriver || null; 
}

/**
 * Renderiza o resumo de leituras diárias de triagem
 */
export function renderSummary(assignments, drivers, painelResumo) {
    if (!painelResumo) return;
    painelResumo.innerHTML = "";

    const totalLeituras = assignments.length;
    const totalPrioritarios = assignments.filter(a => a.priority === true).length; 

    const headerDiv = document.createElement('div');
    headerDiv.className = "flex justify-between items-center pb-2 border-b text-sm font-semibold text-gray-700";
    headerDiv.innerHTML = `
        <span>Total Processado:</span>
        <div class="flex items-center space-x-1.5">
            <span class="bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-xs font-bold" title="Total de encomendas">${totalLeituras} un</span>
            ${totalPrioritarios > 0 ? `<span class="bg-orange-500 text-white px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center space-x-1" title="Prioritárias"><i class="fa-solid fa-circle-exclamation"></i> <span>${totalPrioritarios}</span></span>` : ''}
        </div>
    `;
    painelResumo.appendChild(headerDiv);

    if (drivers.length === 0) {
        painelResumo.innerHTML += `<p class="text-xs text-gray-400 italic text-center py-2">Registe motoristas para ver o resumo.</p>`;
        return;
    }

    drivers.forEach(driver => {
        const totalDriver = assignments.filter(a => a.driverId === driver.id).length;
        const totalPrioritariosDriver = assignments.filter(a => a.driverId === driver.id && a.priority === true).length;
        const percent = totalLeituras > 0 ? Math.round((totalDriver / totalLeituras) * 100) : 0;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between text-xs py-1";
        row.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="w-3.5 h-3.5 rounded-full" style="background-color: ${driver.color}"></span>
                <span class="font-medium text-gray-700">${driver.name}</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-gray-900">
                <span>${totalDriver} un</span>
                ${totalPrioritariosDriver > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5" title="Prioritários"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalPrioritariosDriver}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percent}%)</span>
            </div>
        `;
        painelResumo.appendChild(row);
    });

    const totalSemMotorista = assignments.filter(a => a.driverId === null).length;
    const totalSemMotoristaPrioridade = assignments.filter(a => a.driverId === null && a.priority === true).length;
    
    if (totalSemMotorista > 0) {
        const percentSem = Math.round((totalSemMotorista / totalLeituras) * 100);
        const rowSem = document.createElement('div');
        rowSem.className = "flex items-center justify-between text-xs py-1 border-t border-dashed mt-1 pt-1";
        rowSem.innerHTML = `
            <div class="flex items-center space-x-2 text-gray-500">
                <span class="w-3.5 h-3.5 rounded-full bg-gray-400"></span>
                <span class="font-medium italic">Sem Motorista</span>
            </div>
            <div class="flex items-center space-x-2 font-bold text-red-600">
                <span>${totalSemMotorista} un</span>
                ${totalSemMotoristaPrioridade > 0 ? `<span class="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center space-x-0.5"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> <span>${totalSemMotoristaPrioridade}</span></span>` : ''}
                <span class="text-gray-400 text-[10px] font-normal">(${percentSem}%)</span>
            </div>
        `;
        painelResumo.appendChild(rowSem);
    }
}