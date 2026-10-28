// Words a dictation engine already spells right on its own. A term made only of
// these needs no vocabulary entry, though it may still need a correction to be
// joined into an identifier (e.g. "price level update" -> PriceLevelUpdate).
const LIST = `
a able about above accept access account across act action active actual add added address admin after again against age agent ago all allow almost alone along already also always am among amount an and another answer any app apply area around array as ask async at auth auto available away
back bad base basic be because become been before begin being below best better between big bit block body book both box branch break bring broken buffer bug build builder built business but button by byte bytes
cache call can cancel card care case cast cause change channel char chart check child choose city class clean clear click client close code cold collect color column come command common company compare complete config connect connection console const contact content context continue control copy core cost could count country course create current custom customer cycle
daily data date day dead deal debug decide decode default define delete delta depth design detail detect dev device diff different direct directory disable display do doc document does done down draw drive drop due during
each early easy edge edit else empty enable encode end engine enough enter entry env equal error even event ever every example exchange exist exit expect export extra
face fact fail false fast feature feed fetch field file fill filter final find fine first fix flag flow focus follow for form format forward found frame free from front full function future
game gate general get give global go good graph great group guard guide
half handle handler happen hard has hash have head header health heap hello help here high history hold home hook host hot hour how
id idea if image impl import in index info init inner input insert inside instance int into is issue it item items its
job join json just
keep key kind know
label large last late later layer layout lead learn left length less let level library life light like limit line link list live load local lock log logic long look loop low
main make manager many map mark market match max may me mean memory merge message meta method middle might min mode model module money more most move much must my
name native need net network never new next no node none normal not note nothing now null number
object of off offer offset old on once one only open option or order other out output over own owner
package page pair panel parent parse part pass path pay peer people per person pick place plan play plugin point pool port post power present price print private process product profile program project proper provide proxy public pull push put
query queue quick quote
range rate raw read ready real reason receive record reduce ref reference region remote remove render reply report request require reset resolve resource response rest result return review right role root route row rule run runner
safe same sample save scale schema scope screen script search second section see select self send server service session set setting setup shape share short should show side sign signal simple single size skip slow small snapshot so some sort source space spec split stack start state static status step stop storage store stream string struct style sub sum support sync system
table tag take target task team template term test text than that the their them then there these they thing this thread through tick time timer to today token too tool top total trace track trade transfer tree true try type
under unit update upper url use used user util
valid value var version view
wait want watch way we web well what when where which while who why will window with without word work worker world would write
yes yet you your
zero
`;

export const COMMON = new Set(LIST.split(/\s+/).filter(Boolean));
