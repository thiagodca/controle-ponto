import React, { useState, useEffect } from 'react';
import { Clock, Users, FileText, LogOut, LogIn, UserPlus, Edit2, Trash2, Save, X, Plus, Search, Download } from 'lucide-react';

// Identificador de versão — usado para confirmar visualmente qual versão do código está rodando
const APP_VERSION = 'v3.1-geolocalizacao';

// Configuração do banco de dados (Supabase)
const SUPABASE_URL = 'https://rnabihjpvnvyrvpwpyjv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mm_lgPs-Zvni1xmdNEvZxA_ZlmbXYHN';

// Função auxiliar para chamadas à API REST do Supabase (PostgREST)
const supabaseRequest = async (table, method = 'GET', { query = '', body = null } = {}) => {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Prefer'] = 'return=representation';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Banco de dados (${method} ${table}) falhou: ${response.status} — ${errorText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

// Conversores entre o formato do banco (snake_case) e o formato usado no app (camelCase)
const dbUserToApp = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  password: u.password,
  profile: u.profile,
  firstAccess: u.first_access,
});

const dbRecordToApp = (r) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  date: r.date,
  time: r.time,
  datetime: r.datetime,
  type: r.type,
  latitude: r.latitude,
  longitude: r.longitude,
  address: r.address,
});

// Obtém a localização atual do navegador (com timeout) e retorna coordenadas.
// Se a pessoa negar a permissão ou o dispositivo não suportar, retorna null
// em vez de travar o registro de ponto — a localização é um "extra", não deve
// impedir o funcionário de bater o ponto.
const getCurrentPosition = () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(null), // permissão negada ou erro — segue sem localização
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
};

// Converte coordenadas em um endereço legível usando o serviço gratuito
// Nominatim (OpenStreetMap). Se falhar, retorna null (não bloqueia o ponto).
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.display_name || null;
  } catch (error) {
    console.warn('Não foi possível obter o endereço:', error.message);
    return null;
  }
};

const ControlePonto = () => {
  // Estado para autenticação
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Estado para navegação
  const [activeView, setActiveView] = useState('clock');
  
  // Estado para usuários
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', profile: 'employee' });
  const [showUserForm, setShowUserForm] = useState(false);
  
  // Estado para registros de ponto
  const [timeRecords, setTimeRecords] = useState([]);
  
  // Estado para consulta
  const [filterName, setFilterName] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  
  // Estado para relatório
  const [reportUser, setReportUser] = useState('');
  const [reportMonth, setReportMonth] = useState('');
  const [reportYear, setReportYear] = useState('');
  
  // Estado de carregamento inicial e mensagens de erro (inline, não usa alert)
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [clockMessage, setClockMessage] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [storageAvailable, setStorageAvailable] = useState(true);

  // Carregar dados do Supabase ao montar
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const usuarios = await supabaseRequest('usuarios', 'GET', { query: '?select=*&order=created_at.asc' });
      setUsers((usuarios || []).map(dbUserToApp));

      const registros = await supabaseRequest('registros_ponto', 'GET', { query: '?select=*&order=datetime.asc' });
      setTimeRecords((registros || []).map(dbRecordToApp));

      setStorageAvailable(true);
    } catch (error) {
      console.error('Erro ao carregar dados do banco:', error);
      setLoadError(error.message || 'Falha ao conectar com o banco de dados.');
      setStorageAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Função de login
  const handleLogin = () => {
    try {
      setLoginError('');
      const emailNormalizado = String(loginEmail || '').trim().toLowerCase();
      const senhaDigitada = String(loginPassword || '');
      
      if (!emailNormalizado || !senhaDigitada) {
        setLoginError('Preencha e-mail e senha.');
        return;
      }
      
      const user = users.find(u => 
        String(u.email || '').trim().toLowerCase() === emailNormalizado && 
        String(u.password || '') === senhaDigitada
      );
      
      if (user) {
        if (user.firstAccess) {
          setLoginEmail(emailNormalizado);
          setShowPasswordSetup(true);
          setLoginPassword(''); // Limpa apenas a senha
        } else {
          setCurrentUser(user);
          setShowLogin(false);
          setActiveView(user.profile === 'admin' ? 'users' : 'clock');
          setLoginEmail('');
          setLoginPassword('');
        }
      } else {
        setLoginError('E-mail ou senha incorretos. Verifique e tente novamente.');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      setLoginError('Erro inesperado ao entrar: ' + error.message);
    }
  };

  // Função para configurar senha no primeiro acesso
  const handlePasswordSetup = async () => {
    setPasswordError('');
    try {
      if (newPassword !== confirmPassword) {
        setPasswordError('As senhas não coincidem!');
        return;
      }
      if (newPassword.length < 4) {
        setPasswordError('A senha deve ter pelo menos 4 caracteres!');
        return;
      }
      
      if (!loginEmail) {
        setPasswordError('E-mail não encontrado. Volte e faça login novamente.');
        setShowPasswordSetup(false);
        return;
      }
      
      const emailNormalizado = String(loginEmail).trim().toLowerCase();
      const userAtual = users.find(u => String(u.email || '').trim().toLowerCase() === emailNormalizado);
      
      if (!userAtual) {
        setPasswordError('Usuário não encontrado. Tente fazer login novamente.');
        return;
      }

      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${userAtual.id}`,
        body: { password: newPassword, first_access: false }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);

      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setCurrentUser(userAtualizado);
      setShowPasswordSetup(false);
      setShowLogin(false);
      setActiveView(userAtualizado.profile === 'admin' ? 'users' : 'clock');
      setNewPassword('');
      setConfirmPassword('');
      setLoginEmail('');
    } catch (error) {
      console.error('Erro ao configurar senha:', error);
      setPasswordError('Erro ao salvar a nova senha: ' + error.message);
    }
  };

  // Função de logout
  const handleLogout = () => {
    setCurrentUser(null);
    setShowLogin(true);
    setActiveView('clock');
    setLoginError('');
    setPasswordError('');
  };

  // Backup manual: baixa um arquivo .json com todos os dados (usuários e registros).
  // Serve como cópia de segurança independente do armazenamento automático —
  // pode ser guardado ou enviado por WhatsApp/e-mail se algo der errado.
  const handleExportBackup = () => {
    try {
      const backup = {
        exportedAt: new Date().toISOString(),
        users,
        timeRecords
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dataHoje = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `backup-controle-ponto-${dataHoje}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar backup:', error);
      alert('Não foi possível gerar o arquivo de backup.');
    }
  };

  // Restaura dados a partir de um arquivo .json exportado anteriormente,
  // recriando os registros no banco de dados (Supabase).
  const handleImportBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!Array.isArray(backup.users)) {
          throw new Error('Arquivo inválido: não contém uma lista de usuários.');
        }
        if (!window.confirm(`Importar este backup vai ADICIONAR estes dados ao banco atual (não apaga o que já existe).\n\nUsuários no arquivo: ${backup.users.length}\nRegistros no arquivo: ${(backup.timeRecords || []).length}\nData do backup: ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('pt-BR') : 'desconhecida'}\n\nDeseja continuar?`)) {
          return;
        }
        alert('Importação de backup para o banco de dados ainda não está disponível nesta versão. Use "Novo Usuário" para recadastrar manualmente, se necessário.');
      } catch (error) {
        console.error('Erro ao importar backup:', error);
        alert('Não foi possível importar o arquivo: ' + error.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // Funções para gerenciamento de usuários
  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email) {
      alert('Preencha todos os campos!');
      return;
    }
    
    if (users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase())) {
      alert('Este e-mail já está cadastrado!');
      return;
    }

    try {
      const inseridos = await supabaseRequest('usuarios', 'POST', {
        body: {
          name: newUser.name,
          email: newUser.email.trim().toLowerCase(),
          password: '123456',
          profile: newUser.profile,
          first_access: true,
        }
      });
      const novoUsuario = dbUserToApp(inseridos[0]);
      setUsers([...users, novoUsuario]);
      setNewUser({ name: '', email: '', profile: 'employee' });
      setShowUserForm(false);
      alert('Usuário cadastrado com sucesso! Senha padrão: 123456');
    } catch (error) {
      console.error('Erro ao cadastrar usuário:', error);
      alert('Não foi possível cadastrar o usuário: ' + error.message);
    }
  };

  const handleEditUser = (user) => {
    setEditingUser({ ...user });
  };

  const handleSaveEdit = async () => {
    try {
      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${editingUser.id}`,
        body: {
          name: editingUser.name,
          email: editingUser.email.trim().toLowerCase(),
          profile: editingUser.profile,
        }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);
      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setEditingUser(null);
    } catch (error) {
      console.error('Erro ao salvar edição:', error);
      alert('Não foi possível salvar a edição: ' + error.message);
    }
  };

  const handleDeleteUser = async (id) => {
    const userParaExcluir = users.find(u => u.id === id);
    if (userParaExcluir && userParaExcluir.email === 'admin@admin.com') {
      alert('Não é possível excluir o administrador padrão!');
      return;
    }
    if (window.confirm('Tem certeza que deseja excluir este usuário?')) {
      try {
        await supabaseRequest('usuarios', 'DELETE', { query: `?id=eq.${id}` });
        setUsers(users.filter(u => u.id !== id));
      } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        alert('Não foi possível excluir o usuário: ' + error.message);
      }
    }
  };

  // Função para registrar ponto
  const [isClockingIn, setIsClockingIn] = useState(false);

  const handleClockIn = async () => {
    if (!currentUser) return;
    setIsClockingIn(true);
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    const todayRecords = timeRecords.filter(r => 
      r.userId === currentUser.id && r.date === today
    );
    
    const type = todayRecords.length % 2 === 0 ? 'entrada' : 'saída';
    
    // Tenta obter localização e endereço — se falhar ou for negado, o ponto
    // ainda assim é registrado normalmente, apenas sem essas informações.
    const posicao = await getCurrentPosition();
    let endereco = null;
    if (posicao) {
      endereco = await reverseGeocode(posicao.latitude, posicao.longitude);
    }
    
    try {
      const inseridos = await supabaseRequest('registros_ponto', 'POST', {
        body: {
          user_id: currentUser.id,
          user_name: currentUser.name,
          date: today,
          time: now.toTimeString().split(' ')[0],
          datetime: now.toISOString(),
          type,
          latitude: posicao ? posicao.latitude : null,
          longitude: posicao ? posicao.longitude : null,
          address: endereco,
        }
      });
      const novoRegistro = dbRecordToApp(inseridos[0]);
      setTimeRecords([...timeRecords, novoRegistro]);
      const avisoLocalizacao = posicao ? '' : ' (localização não disponível)';
      setClockMessage({ text: `Ponto registrado: ${type.toUpperCase()} às ${novoRegistro.time}${avisoLocalizacao}`, error: false });
    } catch (error) {
      console.error('Erro ao salvar registro de ponto:', error);
      setClockMessage({ text: 'Erro ao salvar o ponto: ' + error.message, error: true });
    } finally {
      setIsClockingIn(false);
    }
    
    setTimeout(() => setClockMessage(null), 5000);
  };

  // Função para filtrar registros
  const getFilteredRecords = () => {
    return timeRecords.filter(record => {
      const matchName = !filterName || record.userName.toLowerCase().includes(filterName.toLowerCase());
      const matchMonth = !filterMonth || record.date.substring(5, 7) === filterMonth;
      const matchYear = !filterYear || record.date.substring(0, 4) === filterYear;
      return matchName && matchMonth && matchYear;
    }).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  };

  // Função para calcular horas trabalhadas
  const calculateWorkedHours = (records) => {
    let totalMinutes = 0;
    
    for (let i = 0; i < records.length - 1; i += 2) {
      if (records[i].type === 'entrada' && records[i + 1].type === 'saída') {
        const entrada = new Date(`${records[i].date}T${records[i].time}`);
        const saida = new Date(`${records[i + 1].date}T${records[i + 1].time}`);
        totalMinutes += (saida - entrada) / 60000;
      }
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    return { hours, minutes, totalMinutes };
  };

  // Função para gerar relatório
  const generateReport = () => {
    if (!reportUser) {
      alert('Selecione um funcionário!');
      return;
    }

    const user = users.find(u => u.id === reportUser);
    let filtered = timeRecords.filter(r => r.userId === reportUser);
    
    if (reportMonth) {
      filtered = filtered.filter(r => r.date.substring(5, 7) === reportMonth);
    }
    if (reportYear) {
      filtered = filtered.filter(r => r.date.substring(0, 4) === reportYear);
    }

    filtered.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    // Agrupar por dia
    const byDate = {};
    filtered.forEach(record => {
      if (!byDate[record.date]) {
        byDate[record.date] = [];
      }
      byDate[record.date].push(record);
    });

    return { user, byDate };
  };

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  // Renderização da tela de login
  if (showLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
              <div className="flex items-center justify-center mb-4">
                <Clock className="w-16 h-16" />
              </div>
              <h1 className="text-3xl font-bold text-center">Controle de Ponto</h1>
              <p className="text-center text-indigo-100 mt-2">Sistema de Gestão de Horários</p>
              <p className="text-center text-indigo-200 text-xs mt-3 font-mono bg-black/20 rounded px-2 py-1 inline-block w-full">
                {APP_VERSION}
              </p>
            </div>
            
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                <p className="text-gray-600">Carregando dados...</p>
              </div>
            ) : loadError ? (
              <div className="p-8 text-center">
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-4 mb-4 text-left">
                  <p className="font-semibold mb-1">Não foi possível carregar os dados</p>
                  <p>{loadError}</p>
                </div>
                <button
                  onClick={loadData}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                >
                  Tentar novamente
                </button>
              </div>
            ) : !showPasswordSetup ? (
              <div className="p-8">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">E-mail</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => { setLoginEmail(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="seu@email.com"
                      autoCapitalize="none"
                      autoCorrect="off"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Senha</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="••••••••"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  {loginError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {loginError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleLogin}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                  >
                    <LogIn className="inline mr-2 w-5 h-5" />
                    Entrar
                  </button>
                </div>
                
                <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
                  <p>Primeiro acesso? Use a senha padrão: <strong>123456</strong></p>
                  <p className="mt-2">Admin: admin@admin.com / admin</p>
                </div>
              </div>
            ) : (
              <div className="p-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Primeiro Acesso</h2>
                <p className="text-gray-600 mb-6">Configure sua senha pessoal</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nova Senha</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Mínimo 4 caracteres"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmar Senha</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Digite a senha novamente"
                      onKeyPress={(e) => e.key === 'Enter' && handlePasswordSetup()}
                    />
                  </div>
                  
                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {passwordError}
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowPasswordSetup(false);
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError('');
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handlePasswordSetup}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Renderização do sistema principal
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-2 rounded-lg flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-2xl font-bold text-gray-900 truncate">Controle de Ponto</h1>
                <p className="text-xs sm:text-sm text-gray-600 truncate">
                  {currentUser?.name} ({currentUser?.profile === 'admin' ? 'Admin' : 'Funcionário'})
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium flex-shrink-0"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
          <div className="flex space-x-1 whitespace-nowrap">
            {currentUser?.profile === 'employee' && (
              <button
                onClick={() => setActiveView('clock')}
                className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                  activeView === 'clock'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                Registrar Ponto
              </button>
            )}
            
            {currentUser?.profile === 'admin' && (
              <>
                <button
                  onClick={() => setActiveView('users')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'users'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Users className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Usuários
                </button>
                
                <button
                  onClick={() => setActiveView('records')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'records'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Search className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Registros
                </button>
                
                <button
                  onClick={() => setActiveView('report')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'report'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <FileText className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Relatórios
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tela de Registro de Ponto */}
        {activeView === 'clock' && currentUser?.profile === 'employee' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-5 sm:p-8 text-white text-center">
                <Clock className="w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-3 sm:mb-4" />
                <h2 className="text-2xl sm:text-3xl font-bold mb-2">Registrar Ponto</h2>
                <p className="text-sm sm:text-lg text-indigo-100 capitalize">
                  {new Date().toLocaleDateString('pt-BR', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
                <p className="text-3xl sm:text-4xl font-bold mt-3 sm:mt-4">
                  {new Date().toLocaleTimeString('pt-BR')}
                </p>
              </div>
              
              <div className="p-5 sm:p-8">
                <button
                  onClick={handleClockIn}
                  disabled={isClockingIn}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-5 sm:py-6 rounded-xl font-bold text-lg sm:text-xl hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg disabled:opacity-60"
                >
                  {isClockingIn ? 'OBTENDO LOCALIZAÇÃO...' : 'REGISTRAR PONTO'}
                </button>
                
                {clockMessage && (
                  <div className={`mt-4 rounded-lg px-4 py-3 text-center font-semibold ${
                    clockMessage.error 
                      ? 'bg-red-50 border border-red-200 text-red-700' 
                      : 'bg-green-50 border border-green-200 text-green-700'
                  }`}>
                    {clockMessage.text}
                  </div>
                )}
                
                <div className="mt-6 sm:mt-8">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4">Registros de Hoje</h3>
                  <div className="space-y-2">
                    {currentUser && timeRecords
                      .filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0])
                      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
                      .map(record => (
                        <div key={record.id} className="p-3 sm:p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${record.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span className="font-semibold text-gray-700 capitalize">{record.type}</span>
                            </div>
                            <span className="text-gray-600 font-mono">{record.time}</span>
                          </div>
                          {record.address && (
                            <p className="text-xs text-gray-500 mt-1 pl-6">📍 {record.address}</p>
                          )}
                        </div>
                      ))}
                    {currentUser && timeRecords.filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0]).length === 0 && (
                      <p className="text-gray-500 text-center py-4">Nenhum registro hoje</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tela de Gerenciamento de Usuários */}
        {activeView === 'users' && currentUser?.profile === 'admin' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Gerenciamento de Usuários</h2>
              <button
                onClick={() => setShowUserForm(!showUserForm)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <Plus className="w-5 h-5" />
                Novo Usuário
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Baixar backup (.json)
              </button>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                <Save className="w-4 h-4" />
                Importar backup
                <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </label>
            </div>

            {showUserForm && (
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Cadastrar Novo Usuário</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      placeholder="Nome completo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                    <select
                      value={newUser.profile}
                      onChange={(e) => setNewUser({ ...newUser, profile: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="employee">Funcionário</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowUserForm(false);
                      setNewUser({ name: '', email: '', profile: 'employee' });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    <X className="inline w-5 h-5 mr-1" />
                    Cancelar
                  </button>
                  <button
                    onClick={handleAddUser}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    <Save className="inline w-5 h-5 mr-1" />
                    Salvar
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Nome</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">E-mail</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Perfil</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      {editingUser && editingUser.id === user.id ? (
                        <>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingUser.name}
                              onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="email"
                              value={editingUser.email}
                              onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={editingUser.profile}
                              onChange={(e) => setEditingUser({ ...editingUser, profile: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                              disabled={user.email === 'admin@admin.com'}
                            >
                              <option value="employee">Funcionário</option>
                              <option value="admin">Administrador</option>
                            </select>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={handleSaveEdit}
                                className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                              >
                                <Save className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => setEditingUser(null)}
                                className="p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 font-medium text-gray-900">{user.name}</td>
                          <td className="px-6 py-4 text-gray-600">{user.email}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                              user.profile === 'admin' 
                                ? 'bg-purple-100 text-purple-700' 
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {user.profile === 'admin' ? 'Administrador' : 'Funcionário'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => handleEditUser(user)}
                                className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                              >
                                <Edit2 className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                                disabled={user.email === 'admin@admin.com'}
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tela de Consulta de Registros */}
        {activeView === 'records' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Consultar Registros de Ponto</h2>
            
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Filtros</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Funcionário</label>
                  <input
                    type="text"
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="Digite o nome..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Todos</option>
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2024"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Funcionário</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Data</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Hora</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Tipo</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Localização</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {getFilteredRecords().map(record => (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{record.userName}</td>
                      <td className="px-6 py-4 text-gray-600">{formatDate(record.date)}</td>
                      <td className="px-6 py-4 text-gray-600 font-mono">{record.time}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          record.type === 'entrada' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {record.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-xs max-w-xs">
                        {record.address ? (
                          <a
                            href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline"
                            title={record.address}
                          >
                            📍 {record.address.split(',').slice(0, 2).join(',')}
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {getFilteredRecords().length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  Nenhum registro encontrado
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tela de Relatórios */}
        {activeView === 'report' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Relatório de Ponto</h2>
            
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Gerar Relatório</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                  <select
                    value={reportUser}
                    onChange={(e) => setReportUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.profile === 'employee').map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês (opcional)</label>
                  <select
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Todos</option>
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano (opcional)</label>
                  <input
                    type="number"
                    value={reportYear}
                    onChange={(e) => setReportYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2024"
                  />
                </div>
              </div>
            </div>

            {reportUser && (() => {
              const report = generateReport();
              return (
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
                    <h3 className="text-2xl font-bold mb-2">Relatório de Ponto</h3>
                    <p className="text-lg">Funcionário: {report.user.name}</p>
                    {reportMonth && reportYear && (
                      <p className="text-indigo-100">
                        Período: {['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(reportMonth)]} de {reportYear}
                      </p>
                    )}
                  </div>
                  
                  <div className="p-6">
                    {Object.keys(report.byDate).length === 0 ? (
                      <p className="text-center text-gray-500 py-8">Nenhum registro encontrado para o período selecionado</p>
                    ) : (
                      <div className="space-y-6">
                        {Object.entries(report.byDate).reverse().map(([date, records]) => {
                          const worked = calculateWorkedHours(records);
                          const extraMinutes = Math.max(0, worked.totalMinutes - 480); // 8 horas = 480 minutos
                          const extraHours = Math.floor(extraMinutes / 60);
                          const extraMins = Math.round(extraMinutes % 60);
                          
                          return (
                            <div key={date} className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-lg font-semibold text-gray-900">{formatDate(date)}</h4>
                                  <div className="flex gap-6 text-sm">
                                    <div>
                                      <span className="text-gray-600">Horas Trabalhadas: </span>
                                      <span className="font-semibold text-gray-900">
                                        {worked.hours}h {worked.minutes}m
                                      </span>
                                    </div>
                                    {extraMinutes > 0 && (
                                      <div>
                                        <span className="text-gray-600">Horas Extras: </span>
                                        <span className="font-semibold text-green-600">
                                          {extraHours}h {extraMins}m
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {records.map(record => (
                                    <div key={record.id} className="p-4 bg-gray-50 rounded-lg">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <div className={`w-3 h-3 rounded-full ${record.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                          <span className="font-semibold text-gray-700 capitalize">{record.type}</span>
                                        </div>
                                        <span className="text-gray-600 font-mono text-lg">{record.time}</span>
                                      </div>
                                      {record.address && (
                                        <p className="text-xs text-gray-500 mt-1 pl-6">📍 {record.address}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>
    </div>
  );
};

export default ControlePonto;
